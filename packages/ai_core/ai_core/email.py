"""Daily digest email (product-gap: "nothing brings you back" - a
workflow proposal or a finished daily review sat unseen until the user
happened to reopen the app). Plain smtplib, no email-service SDK/
dependency - this app already self-hosts everything else it can
(fonts, icons, the rich text editor, the toast system), and a daily
digest is one email a day per user, not a marketing platform.

Reuses the exact SMTP_* variable names infra/supabase/docker-compose.yml
already defines for GoTrue's own auth emails (GOTRUE_SMTP_HOST, etc.) -
same credentials, same mail provider, one fewer thing to configure
twice. Deliberately does NOT touch GoTrue's SMTP config or its
container - this sends independently from the worker.
"""

from __future__ import annotations

import os
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage


def smtp_configured() -> bool:
    """False until real SMTP_HOST/SMTP_USER/SMTP_PASS are set - the
    digest pass checks this every run and silently no-ops otherwise
    (see worker/main.py's run_daily_digest_pass), so deploying without
    mail configured is a supported, ordinary state, not an error."""
    return bool(os.environ.get("SMTP_HOST") and os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))


@dataclass
class DigestContent:
    """What's worth emailing about, gathered by the caller (worker/
    main.py has the DB access - this module only knows how to turn it
    into an email and send it). Empty digests are never sent - see
    has_content below - so a quiet day produces no email at all rather
    than a "nothing happened today!" message nobody wants."""

    overdue_task_titles: list[str] = field(default_factory=list)
    new_workflow_proposals: list[str] = field(default_factory=list)
    daily_review_ready: bool = False
    daily_review_priorities: list[str] = field(default_factory=list)

    @property
    def has_content(self) -> bool:
        return bool(
            self.overdue_task_titles or self.new_workflow_proposals or self.daily_review_ready
        )


def _render_text(content: DigestContent, app_url: str) -> str:
    lines = ["Here's what's waiting for you in Agentic Second Brain:", ""]

    if content.daily_review_ready:
        lines.append("Today's review is ready.")
        for p in content.daily_review_priorities[:3]:
            lines.append(f"  - {p}")
        lines.append("")

    if content.new_workflow_proposals:
        lines.append(f"{len(content.new_workflow_proposals)} project(s) flagged by the Workflow agent:")
        for issue in content.new_workflow_proposals[:5]:
            lines.append(f"  - {issue}")
        lines.append("")

    if content.overdue_task_titles:
        lines.append(f"{len(content.overdue_task_titles)} task(s) overdue:")
        for title in content.overdue_task_titles[:5]:
            lines.append(f"  - {title}")
        lines.append("")

    lines.append(f"Open your dashboard: {app_url}/dashboard")
    return "\n".join(lines)


def send_digest(to_email: str, content: DigestContent, app_url: str) -> None:
    """Raises on any SMTP failure - the caller (worker) is responsible
    for catching per-user so one bad send doesn't skip the rest of the
    sweep, same pattern as every other worker pass."""
    msg = EmailMessage()
    msg["Subject"] = "Your Agentic Second Brain digest"
    msg["From"] = os.environ.get("SMTP_SENDER_NAME") or os.environ["SMTP_USER"]
    msg["To"] = to_email
    msg.set_content(_render_text(content, app_url))

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as smtp:
        smtp.starttls()
        smtp.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
        smtp.send_message(msg)
