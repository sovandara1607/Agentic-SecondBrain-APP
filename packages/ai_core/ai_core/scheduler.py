"""Phase 2 task scheduling (design doc Section 15): deterministic and
explainable first, AI-assisted second. run_scheduler implements steps
1-5 (score, build availability, greedy placement, at_risk fallback);
run_missed_task_pass implements step 6 separately since it runs on its
own hourly cadence, not as part of a placement run.

Two real gaps vs. the spec, worth being explicit about rather than
quietly approximating:
- projects has no priority/weight column (0001_initial_schema.sql).
  project_weight is derived from the same urgency-decay curve used for
  task deadlines, applied to the project's own target_date, defaulting
  to a neutral 0.5 when there's no project or no target_date - a
  reasonable stand-in, not literally "the parent project's own priority"
  as the spec describes it.
- The missed-task pass's dependency cascade ("shifts dependents'
  earliest possible start... can cascade into the project's target_date
  being flagged at risk") isn't implemented - releasing the block and
  requeuing the task is real and tested; the cascade analysis is a
  separate, more involved feature left for later.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone

import psycopg

URGENCY_HORIZON_DAYS = 14
PLANNING_HORIZON_DAYS = 14
DEFAULT_BUFFER_MINUTES = 10
ENERGY_RANK = {"low": 0, "medium": 1, "high": 2}
# (name, start, end) - the working day is sliced into these three fixed
# bands, each tagged by profiles.energy_profile[name].
PERIODS = [
    ("morning", time(0, 0), time(12, 0)),
    ("afternoon", time(12, 0), time(17, 0)),
    ("evening", time(17, 0), time(23, 59)),
]


def _urgency(target: date | None, today: date) -> float:
    """Days to deadline, curved so overdue/due-today dominate: 1.0 at or
    past the deadline, decaying linearly to 0 over URGENCY_HORIZON_DAYS,
    0.3 baseline for undated tasks (present, but not urgency-driven)."""
    if target is None:
        return 0.3
    days = (target - today).days
    if days <= 0:
        return 1.0
    return max(0.0, 1.0 - (days / URGENCY_HORIZON_DAYS))


def _priority_score(priority: int) -> float:
    # priority 1 (highest) -> 1.0, priority 5 (lowest) -> 0.2
    return (6 - priority) / 5


@dataclass
class Candidate:
    id: uuid.UUID
    title: str
    priority: int
    deadline: date | None
    energy_level: str
    estimated_minutes: int
    project_id: uuid.UUID | None
    project_target_date: date | None
    score: float = 0.0


@dataclass
class SchedulerResult:
    placed: list[tuple[uuid.UUID, datetime, datetime]] = field(default_factory=list)
    at_risk: list[uuid.UUID] = field(default_factory=list)


@dataclass
class MissedTaskResult:
    released: list[uuid.UUID] = field(default_factory=list)


def _fetch_candidates(cur: psycopg.Cursor, user_id: uuid.UUID) -> list[Candidate]:
    # Step 1: open tasks with no not-yet-done dependency.
    cur.execute(
        """
        select t.id, t.title, t.priority, t.deadline, t.energy_level,
               t.estimated_minutes, t.project_id, p.target_date
        from tasks t
        left join projects p on p.id = t.project_id
        where t.user_id = %s and t.status = 'open'
          and not exists (
            select 1 from task_dependencies td
            join tasks dep on dep.id = td.depends_on_task_id
            where td.task_id = t.id and dep.status != 'done'
          )
        """,
        (user_id,),
    )
    return [
        Candidate(
            id=row[0],
            title=row[1],
            priority=row[2],
            deadline=row[3].date() if row[3] else None,
            energy_level=row[4],
            estimated_minutes=row[5],
            project_id=row[6],
            project_target_date=row[7],
        )
        for row in cur.fetchall()
    ]


def _score(candidate: Candidate, weights: dict, today: date) -> float:
    # Step 2.
    urgency = _urgency(candidate.deadline, today)
    priority = _priority_score(candidate.priority)
    project_weight = (
        _urgency(candidate.project_target_date, today) if candidate.project_id else 0.5
    )
    return (
        weights.get("urgency", 0.5) * urgency
        + weights.get("priority", 0.3) * priority
        + weights.get("project_weight", 0.2) * project_weight
    )


def _free_intervals(
    period_start: datetime,
    period_end: datetime,
    busy: list[tuple[datetime, datetime]],
) -> list[tuple[datetime, datetime]]:
    """period_start..period_end minus the union of busy intervals
    overlapping it, left to right."""
    free = []
    cursor = period_start
    overlapping = sorted(b for b in busy if b[1] > period_start and b[0] < period_end)
    for busy_start, busy_end in overlapping:
        busy_start = max(busy_start, period_start)
        busy_end = min(busy_end, period_end)
        if busy_start > cursor:
            free.append((cursor, busy_start))
        cursor = max(cursor, busy_end)
    if cursor < period_end:
        free.append((cursor, period_end))
    return free


def _try_place(
    candidate: Candidate,
    today: date,
    work_days: set[int],
    start_time: time,
    end_time: time,
    energy_profile: dict,
    busy: list[tuple[datetime, datetime]],
) -> tuple[datetime, datetime] | None:
    # Steps 3-4: walk the planning horizon day by day, period by period,
    # returning the first slot that fits - both duration and energy.
    for day_offset in range(PLANNING_HORIZON_DAYS):
        day = today + timedelta(days=day_offset)
        if day.isoweekday() not in work_days:
            continue
        if candidate.deadline and day > candidate.deadline:
            return None
        for period_name, p_start, p_end in PERIODS:
            period_energy = energy_profile.get(period_name, "medium")
            if ENERGY_RANK.get(period_energy, 1) < ENERGY_RANK.get(candidate.energy_level, 1):
                continue
            day_start = max(
                datetime.combine(day, start_time, tzinfo=timezone.utc),
                datetime.combine(day, p_start, tzinfo=timezone.utc),
            )
            day_end = min(
                datetime.combine(day, end_time, tzinfo=timezone.utc),
                datetime.combine(day, p_end, tzinfo=timezone.utc),
            )
            if day_end <= day_start:
                continue
            for free_start, free_end in _free_intervals(day_start, day_end, busy):
                duration = (free_end - free_start).total_seconds() / 60
                if duration >= candidate.estimated_minutes:
                    return free_start, free_start + timedelta(minutes=candidate.estimated_minutes)
    return None


def run_scheduler(conn: psycopg.Connection, user_id: uuid.UUID) -> SchedulerResult:
    with conn.cursor() as cur:
        cur.execute(
            "select working_hours, energy_profile, scheduler_weights from profiles where id = %s",
            (user_id,),
        )
        row = cur.fetchone()
        if row is None:
            raise ValueError(f"profile {user_id} not found")
        working_hours, energy_profile, weights = row

        candidates = _fetch_candidates(cur, user_id)
        today = datetime.now(timezone.utc).date()
        for c in candidates:
            c.score = _score(c, weights, today)
        candidates.sort(key=lambda c: c.score, reverse=True)

        work_days = set(working_hours.get("days", [1, 2, 3, 4, 5]))
        start_time = time.fromisoformat(working_hours.get("start", "09:00"))
        end_time = time.fromisoformat(working_hours.get("end", "18:00"))

        horizon_start = datetime.combine(today, time.min, tzinfo=timezone.utc)
        horizon_end = horizon_start + timedelta(days=PLANNING_HORIZON_DAYS)
        cur.execute(
            """
            select starts_at, ends_at from time_blocks
            where user_id = %s and status = 'scheduled'
              and starts_at < %s and ends_at > %s
            order by starts_at
            """,
            (user_id, horizon_end, horizon_start),
        )
        busy = list(cur.fetchall())

        result = SchedulerResult()
        for candidate in candidates:
            slot = _try_place(
                candidate, today, work_days, start_time, end_time, energy_profile, busy
            )
            if slot:
                free_start, block_end = slot
                cur.execute(
                    """
                    insert into time_blocks (user_id, task_id, starts_at, ends_at, status)
                    values (%s, %s, %s, %s, 'scheduled')
                    """,
                    (user_id, candidate.id, free_start, block_end),
                )
                cur.execute(
                    "update tasks set status = 'scheduled' where id = %s", (candidate.id,)
                )
                busy.append(
                    (free_start, block_end + timedelta(minutes=DEFAULT_BUFFER_MINUTES))
                )
                result.placed.append((candidate.id, free_start, block_end))
            else:
                # Step 5: don't force it in.
                cur.execute(
                    "update tasks set status = 'at_risk' where id = %s", (candidate.id,)
                )
                if candidate.project_id:
                    cur.execute(
                        """
                        update projects set risks = risks || jsonb_build_array(
                            jsonb_build_object(
                                'task_id', %s::text,
                                'reason', 'could not be scheduled before its deadline',
                                'flagged_at', now()
                            )
                        )
                        where id = %s
                        """,
                        (str(candidate.id), candidate.project_id),
                    )
                result.at_risk.append(candidate.id)

    conn.commit()
    return result


def run_missed_task_pass(conn: psycopg.Connection) -> MissedTaskResult:
    """Step 6. Global sweep across all users - simpler than per-user
    dispatch and no less correct, since it's a maintenance pass, not a
    placement decision that needs a user's profile/weights."""
    with conn.cursor() as cur:
        cur.execute(
            """
            select tb.id, tb.task_id from time_blocks tb
            join tasks t on t.id = tb.task_id
            where tb.status = 'scheduled' and tb.ends_at < now() and t.status != 'done'
            """
        )
        rows = cur.fetchall()
        result = MissedTaskResult()
        for block_id, task_id in rows:
            cur.execute("update time_blocks set status = 'missed' where id = %s", (block_id,))
            cur.execute("update tasks set status = 'open' where id = %s", (task_id,))
            result.released.append(task_id)
    conn.commit()
    return result
