"""Workflow agent (design doc Section 6): "monitor, diagnose, propose".
Reads projects/tasks, writes proposals only - "The one hard rule across
all agents: read and suggest freely, write only what's unambiguous ... or
explicitly confirmed by the user" (Section 6). Every proposal lands in
`agent_actions` with `status = 'proposed'` (the schema's own enum already
has this exact state, applied | proposed | confirmed | rejected), nothing
in `projects` or `tasks` is ever touched here.

MVP shipped this as a manual "check my projects" action; the v2 item
Section 17 flags ("Workflow Agent autonomous triggers ... v2 automates
the trigger ... once its suggestions have a track record the user
trusts") is now also wired up - `worker/main.py`'s run_workflow_check_pass
calls this on a periodic sweep across all users, in addition to the
still-live manual POST /agents/workflow/check endpoint. This module
itself remains schedule-agnostic either way: it just answers "does this
user have anything worth flagging right now," and RECHECK_WINDOW below
is what keeps the periodic sweep from spamming duplicate proposals.

Signals are gathered deterministically (stalled/at-risk/overdue tasks,
an approaching target_date with low progress) - only projects that trip
at least one signal go to the model at all, and the model is only asked
to turn a signal into a one-line diagnosis and a concrete next step, not
to invent risk on its own. Re-running the check within RECHECK_WINDOW
skips any project that already has an unresolved proposal, so mashing
"check" repeatedly doesn't spam duplicate proposals for the same issue.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import date, timedelta

import psycopg
from ai_core.client import CHAT_MODEL
from ai_core.i18n import language_suffix

STALL_DAYS = 7
TARGET_DATE_HORIZON_DAYS = 14
LOW_PROGRESS_THRESHOLD = 0.5
RECHECK_WINDOW = timedelta(hours=24)

_SYSTEM_PROMPT = (
    "You are the Workflow agent for a personal second-brain app, reviewing "
    "projects flagged by automated signals (stalled activity, at-risk or "
    "overdue tasks, an approaching deadline with low progress). For each "
    "project, write a one-sentence diagnosis of what's actually wrong and "
    "one concrete, specific next step the user could take. Only propose "
    "for projects in the list - don't invent problems beyond the signals "
    "given, and don't propose anything for a project with no real issue."
)

_RESPONSE_SCHEMA = {
    "name": "workflow_proposals",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "proposals": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "project_name": {
                            "type": "string",
                            "description": "Must exactly match one of the provided project names.",
                        },
                        "issue": {"type": "string", "description": "One-sentence diagnosis."},
                        "proposed_action": {
                            "type": "string",
                            "description": "One concrete, specific next step.",
                        },
                    },
                    "required": ["project_name", "issue", "proposed_action"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["proposals"],
        "additionalProperties": False,
    },
}


@dataclass
class WorkflowProposal:
    id: uuid.UUID
    project_id: uuid.UUID
    project_name: str
    issue: str
    proposed_action: str


@dataclass
class WorkflowCheckResult:
    proposals: list[WorkflowProposal]
    projects_checked: int
    projects_flagged: int


def _fetch_project_signals(cur, user_id: uuid.UUID, today: date) -> list[dict]:
    cur.execute(
        """
        select p.id, p.name, p.target_date,
               count(t.id) as total_tasks,
               count(t.id) filter (where t.status = 'done') as done_tasks,
               count(t.id) filter (where t.status = 'at_risk') as at_risk_tasks,
               count(t.id) filter (
                   where t.status not in ('done', 'canceled') and t.deadline is not null and t.deadline < now()
               ) as overdue_tasks,
               max(greatest(t.updated_at, t.created_at)) as last_task_activity
        from projects p
        left join tasks t on t.project_id = p.id
        where p.user_id = %s and p.status = 'active'
        group by p.id, p.name, p.target_date
        """,
        (user_id,),
    )

    flagged = []
    for project_id, name, target_date, total, done, at_risk, overdue, last_activity in cur.fetchall():
        signals = []
        if at_risk:
            signals.append(f"{at_risk} task(s) marked at_risk")
        if overdue:
            signals.append(f"{overdue} task(s) past their deadline and not done")
        if total and last_activity:
            stalled_days = (today - last_activity.date()).days
            if stalled_days >= STALL_DAYS:
                signals.append(f"no task activity in {stalled_days} days despite {total} open task(s)")
        if target_date:
            days_to_target = (target_date - today).days
            progress = (done / total) if total else 0.0
            if 0 <= days_to_target <= TARGET_DATE_HORIZON_DAYS and progress < LOW_PROGRESS_THRESHOLD:
                signals.append(
                    f"target date is {days_to_target} day(s) away with only "
                    f"{round(progress * 100)}% of tasks done"
                )

        if signals:
            flagged.append({"id": project_id, "name": name, "signals": signals})

    return flagged


def _has_recent_unresolved_proposal(cur, user_id: uuid.UUID, project_id: uuid.UUID) -> bool:
    cur.execute(
        """
        select 1 from agent_actions
        where user_id = %s and agent_name = 'workflow' and status = 'proposed'
          and target_type = 'project' and target_id = %s
          and created_at > now() - %s::interval
        limit 1
        """,
        (user_id, project_id, RECHECK_WINDOW),
    )
    return cur.fetchone() is not None


def run_workflow_check(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    language: str = "en",
) -> WorkflowCheckResult:
    today = date.today()
    with conn.cursor() as cur:
        flagged = _fetch_project_signals(cur, user_id, today)
        cur.execute("select count(*) from projects where user_id = %s and status = 'active'", (user_id,))
        projects_checked = cur.fetchone()[0]

    if not flagged:
        return WorkflowCheckResult(proposals=[], projects_checked=projects_checked, projects_flagged=0)

    payload = json.dumps(
        [{"project_name": p["name"], "signals": p["signals"]} for p in flagged]
    )
    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT + language_suffix(language)},
            {"role": "user", "content": f"Flagged projects and their signals:\n{payload}"},
        ],
        response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
    )
    raw_proposals = json.loads(response.content).get("proposals", [])

    by_name = {p["name"]: p for p in flagged}
    proposals: list[WorkflowProposal] = []
    with conn.cursor() as cur:
        for raw in raw_proposals:
            project = by_name.get(raw.get("project_name"))
            if project is None:
                continue
            if _has_recent_unresolved_proposal(cur, user_id, project["id"]):
                continue

            cur.execute(
                """
                insert into agent_actions
                    (user_id, agent_name, action_kind, target_type, target_id, summary, detail, status)
                values (%s, 'workflow', 'suggested', 'project', %s, %s, %s, 'proposed')
                returning id
                """,
                (
                    user_id,
                    project["id"],
                    raw["issue"],
                    json.dumps({"proposed_action": raw["proposed_action"], "signals": project["signals"]}),
                ),
            )
            action_id = cur.fetchone()[0]
            proposals.append(
                WorkflowProposal(
                    id=action_id,
                    project_id=project["id"],
                    project_name=project["name"],
                    issue=raw["issue"],
                    proposed_action=raw["proposed_action"],
                )
            )

    conn.commit()
    return WorkflowCheckResult(
        proposals=proposals, projects_checked=projects_checked, projects_flagged=len(flagged)
    )
