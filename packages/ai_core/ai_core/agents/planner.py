"""Planner agent (design doc Section 6): "decompose, sequence, estimate,
schedule" - the MyLMS example in Section 15. Reads a project, writes
tasks, structural task_dependencies, and (indirectly, via the existing
on_task_created trigger from 0003_scheduler.sql) time_blocks once the
scheduler picks the new tasks up.

Two deliberate simplifications vs. a literal reading of Section 15:

- "Each group becomes a part_of relationship to a parent task or
  directly to the project" - this implementation always links leaves
  directly to the project (the spec's own second option), not to a
  synthetic parent task row. A parent task row would need to be
  non-schedulable, and the tasks.status enum (0001_initial_schema.sql)
  has no such state - every status the scheduler doesn't special-case is
  fair game for its candidate-set query. Rather than teach the scheduler
  about a new "organizational, not real work" status, group names live
  on each leaf task's `context` field (human-readable, "Part of: X") and
  the grouping itself is only preserved in the agent_actions detail
  blob, not as a first-class row.
- Structural dependencies ("Testing depends on Development") are
  expanded to every-leaf-in-group-B depends-on-every-leaf-in-group-A,
  since task_dependencies is a task-to-task table with no group concept.
  Bounded by construction (a plan has a handful of groups, each with a
  handful of tasks), and correctly blocks the candidate set until the
  whole prerequisite group is done, which is what "depends on" means at
  the group level.

No cycle detection on depends_on_groups: a group naming itself is
dropped, but a longer cycle (A depends on B depends on A) isn't caught.
Left unhandled because a real decomposition from one goal is a
DAG by construction (the model is asked for a forward-looking plan, not
an arbitrary graph) - worth revisiting if this agent is ever driven by
less structured input.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field

import psycopg
from ai_core.client import CHAT_MODEL
from ai_core.i18n import language_suffix


class CycleDetectedError(ValueError):
    """Raised when a cyclic dependency is detected in group dependencies."""
    pass


def _detect_cycle(group_names: set[str], depends_on: dict[str, list[str]]) -> list[str] | None:
    """Detect cycles in group dependency graph using DFS.
    Returns the cycle path if found, None otherwise."""
    visited: set[str] = set()
    rec_stack: set[str] = set()
    path: list[str] = []

    def dfs(node: str) -> list[str] | None:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)

        for neighbor in depends_on.get(node, []):
            if neighbor not in group_names:
                continue
            if neighbor not in visited:
                cycle = dfs(neighbor)
                if cycle:
                    return cycle
            elif neighbor in rec_stack:
                # Found cycle - return path from neighbor to current node
                idx = path.index(neighbor)
                return path[idx:] + [neighbor]

        rec_stack.remove(node)
        path.pop()
        return None

    for node in group_names:
        if node not in visited:
            cycle = dfs(node)
            if cycle:
                return cycle
    return None


_SYSTEM_PROMPT = (
    "You are the Planner agent for a personal second-brain app. Break the "
    "stated goal into a small number of logical groups (phases), each "
    "containing concrete, actionable leaf tasks - not the groups "
    "themselves. Keep the plan realistic in size (roughly 3-6 groups, "
    "2-5 tasks each) rather than exhaustive. Mark a group as depending "
    "on another only when the dependency is structurally obvious (e.g. "
    "testing depends on development), leave anything looser out."
)

_RESPONSE_SCHEMA = {
    "name": "goal_decomposition",
    "strict": True,
    "schema": {
        "type": "object",
        "properties": {
            "groups": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Short phase name, e.g. 'Development'."},
                        "depends_on_groups": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Names of other groups in this same plan that must finish first. Empty if none.",
                        },
                        "tasks": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "estimated_minutes": {
                                        "type": "integer",
                                        "description": "Realistic effort estimate in minutes.",
                                    },
                                    "energy_level": {
                                        "type": "string",
                                        "enum": ["low", "medium", "high"],
                                    },
                                    "priority": {
                                        "type": "integer",
                                        "description": "1 (highest) to 5 (lowest).",
                                    },
                                },
                                "required": ["title", "estimated_minutes", "energy_level", "priority"],
                                "additionalProperties": False,
                            },
                        },
                    },
                    "required": ["name", "depends_on_groups", "tasks"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["groups"],
        "additionalProperties": False,
    },
}


@dataclass
class GroupResult:
    name: str
    task_ids: list[uuid.UUID] = field(default_factory=list)


@dataclass
class PlannerResult:
    project_id: uuid.UUID
    groups: list[GroupResult]

    @property
    def total_tasks(self) -> int:
        return sum(len(g.task_ids) for g in self.groups)


class ProjectNotFoundError(ValueError):
    pass


def _fetch_project(cur, user_id: uuid.UUID, project_id: uuid.UUID) -> tuple[str, str | None, str | None]:
    cur.execute(
        "select name, overview, goals from projects where id = %s and user_id = %s",
        (project_id, user_id),
    )
    row = cur.fetchone()
    if row is None:
        raise ProjectNotFoundError(f"project {project_id} not found for this user")
    return row


def decompose_project(
    conn: psycopg.Connection,
    client,
    user_id: uuid.UUID,
    project_id: uuid.UUID,
    goal: str,
    language: str = "en",
) -> PlannerResult:
    with conn.cursor() as cur:
        name, overview, goals = _fetch_project(cur, user_id, project_id)

    project_context = f"Project: {name}"
    if overview:
        project_context += f"\nOverview: {overview}"
    if goals:
        project_context += f"\nGoals: {goals}"

    response = client.chat.completions.create(
        model=CHAT_MODEL,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT + language_suffix(language)},
            {"role": "user", "content": f"{project_context}\n\nGoal to decompose: {goal}"},
        ],
        response_format={"type": "json_schema", "json_schema": _RESPONSE_SCHEMA},
    )
    plan = json.loads(response.content)
    raw_groups = plan.get("groups", [])
    group_names = {g["name"] for g in raw_groups}

    # Build dependency map and check for cycles
    depends_on: dict[str, list[str]] = {}
    for group in raw_groups:
        depends_on[group["name"]] = [
            n for n in group.get("depends_on_groups", []) if n in group_names and n != group["name"]
        ]
    cycle = _detect_cycle(group_names, depends_on)
    if cycle:
        raise CycleDetectedError(f"Cyclic group dependency detected: {' -> '.join(cycle)}")

    results: list[GroupResult] = []
    with conn.cursor() as cur:
        for group in raw_groups:
            group_result = GroupResult(name=group["name"])
            for task in group["tasks"]:
                cur.execute(
                    """
                    insert into tasks
                        (user_id, project_id, title, context, priority, energy_level, estimated_minutes)
                    values (%s, %s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (
                        user_id,
                        project_id,
                        task["title"],
                        f"Part of: {group['name']}",
                        task["priority"],
                        task["energy_level"],
                        task["estimated_minutes"],
                    ),
                )
                task_id = cur.fetchone()[0]
                group_result.task_ids.append(task_id)

                cur.execute(
                    """
                    insert into relationships (user_id, source_type, source_id, target_type, target_id, relation_kind)
                    values (%s, 'task', %s, 'project', %s, 'part_of')
                    """,
                    (user_id, task_id, project_id),
                )
            results.append(group_result)

        by_name = {g.name: g for g in results}
        for group, group_result in zip(raw_groups, results):
            for prereq_name in depends_on.get(group["name"], []):
                prereq = by_name.get(prereq_name)
                if prereq is None:
                    continue
                for task_id in group_result.task_ids:
                    for prereq_task_id in prereq.task_ids:
                        cur.execute(
                            """
                            insert into task_dependencies (task_id, depends_on_task_id)
                            values (%s, %s)
                            on conflict do nothing
                            """,
                            (task_id, prereq_task_id),
                        )

        total_tasks = sum(len(g.task_ids) for g in results)
        cur.execute(
            """
            insert into agent_actions
                (user_id, agent_name, action_kind, target_type, target_id, summary, detail)
            values (%s, 'planner', 'created', 'project', %s, %s, %s)
            """,
            (
                user_id,
                project_id,
                f"Decomposed \"{goal}\" into {total_tasks} tasks across {len(results)} groups.",
                json.dumps(
                    {
                        "goal": goal,
                        "groups": [
                            {"name": g.name, "task_ids": [str(t) for t in g.task_ids]}
                            for g in results
                        ],
                    }
                ),
            ),
        )

    conn.commit()
    return PlannerResult(project_id=project_id, groups=results)
