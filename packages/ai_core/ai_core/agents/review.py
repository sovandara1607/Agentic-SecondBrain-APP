"""Review agent (design doc Section 6): "gather, summarize, flag" - both
halves of Section 2.11/2.12. Daily reads one user's task/note/time_block
activity for a single day and writes one `daily_reviews` row. Weekly
reads the same surface over a 7-day window and writes one
`weekly_reviews` row, trading per-item detail for aggregates (project
progress, time allocation) a week is actually the right grain for.

In both, everything factual is plain SQL, deliberately not run through
the model - a user auditing "what did this review say happened" is
reading the database, not a paraphrase of it that could hallucinate a
task that didn't actually complete. Only the forward-looking field
(`tomorrow_priorities` / `recommendations`) is model-generated: picking
what matters next is a judgment call, the one part of "gather,
summarize, flag" that can't just be read out of a table.

Both upsert on their natural key ((user_id, review_date) /
(user_id, week_start)) so re-triggering the same period (Section 5.2's
`POST /agents/review/daily` and `/weekly`, "trigger or re-trigger")
replaces the row instead of accumulating duplicates.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
from ai_core.client import CHAT_MODEL
from ai_core.i18n import language_suffix


_SYSTEM_PROMPT = (
    "You are the Review agent for a personal second-brain app, writing a "
    "short nightly review. Given today's completed tasks, still-open "
    "tasks, new notes, decisions, and blockers, suggest a short, realistic "
    "list of priorities for tomorrow. Prefer at-risk and overdue work over "
    "anything not yet due. Keep each priority to one concrete sentence. "
    "If nothing meaningful stands out, it's fine to suggest fewer."
)

_RESPONSE_SCHEMA = {
    "name": "tomorrow_priorities",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "priorities": {
                "type": "array",
                "items": {"type": "string"},
                "description": "3-5 short, concrete priorities for tomorrow.",
            },
        },
        "required": ["priorities"],
        "additionalProperties": False,
    },
}


@dataclass
class DailyReviewResult:
    id: uuid.UUID
    review_date: date
    completed_tasks: list[dict]
    unfinished_tasks: list[dict]
    new_knowledge: list[dict]
    decisions: list[dict]
    blockers: list[dict]
    tomorrow_priorities: list[str]


def _fetch_completed_tasks(cur, user_id: uuid.UUID, review_date: date) -> list[dict]:
    cur.execute(
        """
        select id, title, project_id
        from tasks
        where user_id = %s and status = 'done' and completed_at::date = %s
        order by completed_at
        """,
        (user_id, review_date),
    )
    return [
        {"id": str(r[0]), "title": r[1], "project_id": str(r[2]) if r[2] else None}
        for r in cur.fetchall()
    ]


def _fetch_unfinished_tasks(cur, user_id: uuid.UUID, review_date: date) -> list[dict]:
    # "Unfinished", not "every open task" (Section 2.11) - scoped to work
    # that was actually supposed to happen today: it had a time block
    # today, or its deadline was today, and it still isn't done.
    cur.execute(
        """
        select distinct t.id, t.title, t.status, t.deadline
        from tasks t
        left join time_blocks tb on tb.task_id = t.id and tb.starts_at::date = %s
        where t.user_id = %s
          and t.status not in ('done', 'canceled')
          and (tb.id is not null or t.deadline::date = %s)
        order by t.deadline nulls last
        """,
        (review_date, user_id, review_date),
    )
    return [
        {
            "id": str(r[0]),
            "title": r[1],
            "status": r[2],
            "deadline": r[3].isoformat() if r[3] else None,
        }
        for r in cur.fetchall()
    ]


def _fetch_new_knowledge(cur, user_id: uuid.UUID, review_date: date) -> list[dict]:
    cur.execute(
        """
        select id, title, note_type
        from notes
        where user_id = %s and created_at::date = %s and note_type != 'decision'
        order by created_at
        """,
        (user_id, review_date),
    )
    return [{"id": str(r[0]), "title": r[1], "note_type": r[2]} for r in cur.fetchall()]


def _fetch_decisions(cur, user_id: uuid.UUID, review_date: date) -> list[dict]:
    cur.execute(
        """
        select id, title
        from notes
        where user_id = %s and created_at::date = %s and note_type = 'decision'
        order by created_at
        """,
        (user_id, review_date),
    )
    return [{"id": str(r[0]), "title": r[1]} for r in cur.fetchall()]


def _fetch_blockers(cur, user_id: uuid.UUID, review_date: date) -> list[dict]:
    # Two distinct kinds of blocker, both already flagged elsewhere in the
    # schema, just gathered here rather than re-derived: tasks the
    # scheduler marked at_risk (Section 15 step 5), and tasks whose time
    # block was missed today (Section 15 step 6).
    cur.execute(
        """
        select id, title, 'at_risk' as reason
        from tasks
        where user_id = %s and status = 'at_risk'
        union all
        select t.id, t.title, 'missed' as reason
        from tasks t
        join time_blocks tb on tb.task_id = t.id
        where t.user_id = %s and tb.status = 'missed' and tb.starts_at::date = %s
        """,
        (user_id, user_id, review_date),
    )
    return [{"id": str(r[0]), "title": r[1], "reason": r[2]} for r in cur.fetchall()]


def generate_daily_review(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    review_date: date,
    language: str = "en",
) -> DailyReviewResult:
    with conn.cursor() as cur:
        completed = _fetch_completed_tasks(cur, user_id, review_date)
        unfinished = _fetch_unfinished_tasks(cur, user_id, review_date)
        new_knowledge = _fetch_new_knowledge(cur, user_id, review_date)
        decisions = _fetch_decisions(cur, user_id, review_date)
        blockers = _fetch_blockers(cur, user_id, review_date)

    if completed or unfinished or blockers:
        summary_input = (
            f"Completed today: {json.dumps(completed)}\n"
            f"Still open / due today: {json.dumps(unfinished)}\n"
            f"Blockers: {json.dumps(blockers)}\n"
            f"New notes: {json.dumps(new_knowledge)}\n"
            f"Decisions made: {json.dumps(decisions)}"
        )
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT + language_suffix(language)},
                {"role": "user", "content": summary_input},
            ],
            response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
        )
        tomorrow_priorities = json.loads(response.content).get("priorities", [])
    else:
        # Nothing happened today - an empty day has an obvious empty
        # review, skip the round trip rather than ask the model to
        # invent priorities from nothing.
        tomorrow_priorities = []

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into daily_reviews
                (user_id, review_date, completed_tasks, unfinished_tasks,
                 new_knowledge, decisions, blockers, tomorrow_priorities)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, review_date) do update set
                completed_tasks = excluded.completed_tasks,
                unfinished_tasks = excluded.unfinished_tasks,
                new_knowledge = excluded.new_knowledge,
                decisions = excluded.decisions,
                blockers = excluded.blockers,
                tomorrow_priorities = excluded.tomorrow_priorities
            returning id
            """,
            (
                user_id,
                review_date,
                json.dumps(completed),
                json.dumps(unfinished),
                json.dumps(new_knowledge),
                json.dumps(decisions),
                json.dumps(blockers),
                json.dumps(tomorrow_priorities),
            ),
        )
        review_id = cur.fetchone()[0]

        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'review', 'created', 'daily_review', %s, %s, %s)
            """,
            (
                user_id,
                review_id,
                f"Daily review for {review_date}: {len(completed)} done, "
                f"{len(unfinished)} still open, {len(blockers)} blocker(s).",
                json.dumps({"review_date": review_date.isoformat()}),
            ),
        )

    conn.commit()
    return DailyReviewResult(
        id=review_id,
        review_date=review_date,
        completed_tasks=completed,
        unfinished_tasks=unfinished,
        new_knowledge=new_knowledge,
        decisions=decisions,
        blockers=blockers,
        tomorrow_priorities=tomorrow_priorities,
    )


_WEEKLY_SYSTEM_PROMPT = (
    "You are the Review agent for a personal second-brain app, writing a "
    "short weekly review. Given this week's project progress, missed "
    "deadlines, time allocation, and knowledge learned, suggest a short, "
    "honest list of strategic recommendations for next week. Call out "
    "projects that stalled or missed deadlines rather than only praising "
    "what went well - the point is to tell the truth about what didn't "
    "move. Keep each recommendation to one concrete sentence."
)

_WEEKLY_RESPONSE_SCHEMA = {
    "name": "weekly_recommendations",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "3-5 short, concrete recommendations for next week.",
            },
        },
        "required": ["recommendations"],
        "additionalProperties": False,
    },
}


@dataclass
class WeeklyReviewResult:
    id: uuid.UUID
    week_start: date
    project_progress: list[dict]
    knowledge_learned: list[dict]
    time_allocation: dict[str, int]
    missed_deadlines: list[dict]
    recommendations: list[str]


def _fetch_project_progress(cur, user_id: uuid.UUID, week_start: date, week_end: date) -> list[dict]:
    # progress is derived here, not read from projects.progress - that
    # column is defined as "recomputed on task changes" (Section 4) but
    # nothing in the codebase ever writes it, so it would just report a
    # stale 0% for every project.
    cur.execute(
        """
        select p.id, p.name,
               count(t.id) as total_tasks,
               count(t.id) filter (where t.status = 'done') as done_tasks,
               count(t.id) filter (where t.status = 'done' and t.completed_at >= %s and t.completed_at < %s) as completed_this_week
        from projects p
        join tasks t on t.project_id = p.id
        where p.user_id = %s
        group by p.id, p.name
        order by p.name
        """,
        (week_start, week_end, user_id),
    )
    results = []
    for project_id, name, total, done, completed_this_week in cur.fetchall():
        progress = round(100 * done / total) if total else 0
        results.append(
            {
                "id": str(project_id),
                "name": name,
                "progress": progress,
                "completed_this_week": completed_this_week,
            }
        )
    return results


def _fetch_weekly_knowledge(cur, user_id: uuid.UUID, week_start: date, week_end: date) -> list[dict]:
    cur.execute(
        """
        select id, title, note_type
        from notes
        where user_id = %s and created_at >= %s and created_at < %s and note_type != 'decision'
        order by created_at
        """,
        (user_id, week_start, week_end),
    )
    return [{"id": str(r[0]), "title": r[1], "note_type": r[2]} for r in cur.fetchall()]


def _fetch_time_allocation(cur, user_id: uuid.UUID, week_start: date, week_end: date) -> dict[str, int]:
    # Minutes actually worked, not minutes scheduled: only counts blocks
    # whose task reached 'done', joined through to the project name for a
    # human-readable breakdown ("time allocation", Section 2.12).
    # Projectless tasks are grouped under "No project" rather than dropped.
    cur.execute(
        """
        select coalesce(p.name, 'No project'),
               sum(extract(epoch from (tb.ends_at - tb.starts_at)) / 60)::int
        from time_blocks tb
        join tasks t on t.id = tb.task_id
        left join projects p on p.id = t.project_id
        where tb.user_id = %s and t.status = 'done'
          and tb.starts_at >= %s and tb.starts_at < %s
        group by p.name
        """,
        (user_id, week_start, week_end),
    )
    return {name: minutes for name, minutes in cur.fetchall()}


def _fetch_missed_deadlines(cur, user_id: uuid.UUID, week_start: date, week_end: date) -> list[dict]:
    cur.execute(
        """
        select id, title, deadline
        from tasks
        where user_id = %s and status not in ('done', 'canceled')
          and deadline >= %s and deadline < %s
        order by deadline
        """,
        (user_id, week_start, week_end),
    )
    return [{"id": str(r[0]), "title": r[1], "deadline": r[2].isoformat()} for r in cur.fetchall()]


def generate_weekly_review(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    week_start: date,
    language: str = "en",
) -> WeeklyReviewResult:
    week_end = week_start + timedelta(days=7)

    with conn.cursor() as cur:
        project_progress = _fetch_project_progress(cur, user_id, week_start, week_end)
        knowledge_learned = _fetch_weekly_knowledge(cur, user_id, week_start, week_end)
        time_allocation = _fetch_time_allocation(cur, user_id, week_start, week_end)
        missed_deadlines = _fetch_missed_deadlines(cur, user_id, week_start, week_end)

    if project_progress or missed_deadlines or knowledge_learned:
        summary_input = (
            f"Project progress this week: {json.dumps(project_progress)}\n"
            f"Missed deadlines: {json.dumps(missed_deadlines)}\n"
            f"Time allocation (minutes by project): {json.dumps(time_allocation)}\n"
            f"New knowledge captured: {json.dumps(knowledge_learned)}"
        )
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": _WEEKLY_SYSTEM_PROMPT + language_suffix(language)},
                {"role": "user", "content": summary_input},
            ],
            response_format={"type": "json_schema", "json_schema": _WEEKLY_RESPONSE_SCHEMA},
        )
        recommendations = json.loads(response.content).get("recommendations", [])
    else:
        # A quiet week with no project activity, no deadlines, and
        # nothing captured has nothing for the model to recommend against.
        recommendations = []

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into weekly_reviews
                (user_id, week_start, project_progress, knowledge_learned,
                 time_allocation, missed_deadlines, recommendations)
            values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, week_start) do update set
                project_progress = excluded.project_progress,
                knowledge_learned = excluded.knowledge_learned,
                time_allocation = excluded.time_allocation,
                missed_deadlines = excluded.missed_deadlines,
                recommendations = excluded.recommendations
            returning id
            """,
            (
                user_id,
                week_start,
                json.dumps(project_progress),
                json.dumps(knowledge_learned),
                json.dumps(time_allocation),
                json.dumps(missed_deadlines),
                json.dumps(recommendations),
            ),
        )
        review_id = cur.fetchone()[0]

        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'review', 'created', 'weekly_review', %s, %s, %s)
            """,
            (
                user_id,
                review_id,
                f"Weekly review for week of {week_start}: {len(project_progress)} project(s) "
                f"touched, {len(missed_deadlines)} missed deadline(s).",
                json.dumps({"week_start": week_start.isoformat()}),
            ),
        )

    conn.commit()
    return WeeklyReviewResult(
        id=review_id,
        week_start=week_start,
        project_progress=project_progress,
        knowledge_learned=knowledge_learned,
        time_allocation=time_allocation,
        missed_deadlines=missed_deadlines,
        recommendations=recommendations,
    )


_MONTHLY_SYSTEM_PROMPT = (
    "You are the Review agent for a personal second-brain app, writing a "
    "short monthly rollup from a month's worth of weekly reviews. Given "
    "this month's project progress, time allocation, and missed-deadline "
    "count, suggest a short, honest list of strategic recommendations for "
    "next month. Call out projects that stalled across multiple weeks "
    "rather than only praising what went well. Keep each recommendation "
    "to one concrete sentence."
)

_MONTHLY_RESPONSE_SCHEMA = {
    "name": "monthly_recommendations",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "recommendations": {
                "type": "array",
                "items": {"type": "string"},
                "description": "3-5 short, concrete recommendations for next month.",
            },
        },
        "required": ["recommendations"],
        "additionalProperties": False,
    },
}


@dataclass
class MonthlyReviewResult:
    id: uuid.UUID
    month_start: date
    weeks_included: int
    project_progress: list[dict]
    knowledge_learned_count: int
    time_allocation: dict[str, int]
    missed_deadlines_count: int
    recommendations: list[str]


def _month_bounds(month_start: date) -> date:
    if month_start.month == 12:
        return date(month_start.year + 1, 1, 1)
    return date(month_start.year, month_start.month + 1, 1)


def _fetch_weekly_reviews_for_month(cur, user_id: uuid.UUID, month_start: date, month_end: date):
    cur.execute(
        """
        select project_progress, knowledge_learned, time_allocation, missed_deadlines
        from weekly_reviews
        where user_id = %s and week_start >= %s and week_start < %s
        order by week_start
        """,
        (user_id, month_start, month_end),
    )
    return cur.fetchall()


def generate_monthly_review(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    month_start: date,
    language: str = "en",
) -> MonthlyReviewResult:
    month_end = _month_bounds(month_start)

    with conn.cursor() as cur:
        weeks = _fetch_weekly_reviews_for_month(cur, user_id, month_start, month_end)

    # project_progress rolls up to "latest progress % seen this month" per
    # project (weeks are already ordered oldest-first, so a later week's
    # entry simply overwrites an earlier one) plus a summed monthly
    # completion count - a straight average across weeks would understate
    # a project that only ramped up in week 3.
    projects: dict[str, dict] = {}
    knowledge_learned_count = 0
    time_allocation: dict[str, int] = {}
    missed_deadlines_count = 0

    for week_project_progress, week_knowledge, week_time_allocation, week_missed in weeks:
        for p in week_project_progress or []:
            entry = projects.setdefault(
                p["id"], {"id": p["id"], "name": p["name"], "latest_progress": 0, "completed_this_month": 0}
            )
            entry["latest_progress"] = p.get("progress", entry["latest_progress"])
            entry["completed_this_month"] += p.get("completed_this_week", 0)

        knowledge_learned_count += len(week_knowledge or [])
        missed_deadlines_count += len(week_missed or [])
        for name, minutes in (week_time_allocation or {}).items():
            time_allocation[name] = time_allocation.get(name, 0) + minutes

    project_progress = list(projects.values())

    if weeks:
        summary_input = (
            f"Weeks included: {len(weeks)}\n"
            f"Project progress this month: {json.dumps(project_progress)}\n"
            f"Time allocation (minutes by project): {json.dumps(time_allocation)}\n"
            f"New knowledge captured: {knowledge_learned_count} item(s)\n"
            f"Missed deadlines: {missed_deadlines_count}"
        )
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=[
                {"role": "system", "content": _MONTHLY_SYSTEM_PROMPT + language_suffix(language)},
                {"role": "user", "content": summary_input},
            ],
            response_format={"type": "json_schema", "json_schema": _MONTHLY_RESPONSE_SCHEMA},
        )
        recommendations = json.loads(response.content).get("recommendations", [])
    else:
        # No weekly reviews yet this month - nothing to roll up or
        # recommend against, skip the round trip.
        recommendations = []

    with conn.cursor() as cur:
        cur.execute(
            """
            insert into monthly_reviews
                (user_id, month_start, weeks_included, project_progress,
                 knowledge_learned_count, time_allocation, missed_deadlines_count, recommendations)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            on conflict (user_id, month_start) do update set
                weeks_included = excluded.weeks_included,
                project_progress = excluded.project_progress,
                knowledge_learned_count = excluded.knowledge_learned_count,
                time_allocation = excluded.time_allocation,
                missed_deadlines_count = excluded.missed_deadlines_count,
                recommendations = excluded.recommendations
            returning id
            """,
            (
                user_id,
                month_start,
                len(weeks),
                json.dumps(project_progress),
                knowledge_learned_count,
                json.dumps(time_allocation),
                missed_deadlines_count,
                json.dumps(recommendations),
            ),
        )
        review_id = cur.fetchone()[0]

        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'review', 'created', 'monthly_review', %s, %s, %s)
            """,
            (
                user_id,
                review_id,
                f"Monthly review for {month_start.strftime('%B %Y')}: rolled up "
                f"{len(weeks)} week(s), {missed_deadlines_count} missed deadline(s).",
                json.dumps({"month_start": month_start.isoformat()}),
            ),
        )

    conn.commit()
    return MonthlyReviewResult(
        id=review_id,
        month_start=month_start,
        weeks_included=len(weeks),
        project_progress=project_progress,
        knowledge_learned_count=knowledge_learned_count,
        time_allocation=time_allocation,
        missed_deadlines_count=missed_deadlines_count,
        recommendations=recommendations,
    )
