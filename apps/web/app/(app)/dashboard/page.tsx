import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Icon } from "@/components/ui/icon";
import { EmptyState } from "@/components/empty-state";
import { PriorityBadge } from "@/components/priority-badge";
import { toggleTaskDone } from "../tasks/actions";
import { confirmWorkflowProposal, dismissWorkflowProposal } from "./actions";
import { FormSubmitButton } from "@/components/form-submit-button";
import { Trans } from "@/components/trans";

const CAPTURE_ICON: Record<string, string> = {
  text: "notes",
  url: "link",
  voice: "mic",
  image: "image",
  pdf: "picture_as_pdf",
};

const CAPTURE_STATUS_VARIANT: Record<string, "muted" | "warning" | "success" | "destructive"> = {
  pending: "muted",
  processing: "warning",
  organized: "success",
  needs_review: "warning",
  failed: "destructive",
};

function startEndOfToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const { start: todayStart, end: todayEnd } = startEndOfToday();
  const nowIso = new Date().toISOString();

  const [
    openTasks,
    pendingCaptures,
    activeProjectsCount,
    todaysBlocks,
    activeProjects,
    overdueTasks,
    recentCaptures,
    latestWorkflowProposal,
    latestDailyReview,
    totalCapturesEver,
  ] = await Promise.all([
    supabase.from("tasks").select("*", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("captures").select("*", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("projects").select("*", { count: "exact", head: true }).eq("status", "active"),
    // Today's Focus (Section 2.1): tasks scheduled into today's time blocks.
    supabase
      .from("time_blocks")
      .select("id, starts_at, tasks(id, title, status, priority)")
      .eq("status", "scheduled")
      .gte("starts_at", todayStart)
      .lt("starts_at", todayEnd)
      .order("starts_at", { ascending: true }),
    // Active Projects with progress bars - progress computed below from
    // each project's own tasks, not read from projects.progress (that
    // column is defined as "recomputed on task changes" but nothing
    // writes it - same gap already documented in ai_core/agents/
    // review.py's weekly rollup).
    supabase
      .from("projects")
      .select("id, name, tasks(status)")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("tasks")
      .select("id, title, deadline, priority")
      .not("status", "in", "(done,canceled)")
      .not("deadline", "is", null)
      .lt("deadline", nowIso)
      .order("deadline", { ascending: true })
      .limit(5),
    supabase
      .from("captures")
      .select("id, kind, raw_text, source_url, status, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    // Suggested Next Action: the latest unresolved Workflow proposal
    // (Section 6's monitor/diagnose/propose agent - apps/api/routers/
    // agents.py's POST /agents/workflow/check writes these).
    supabase
      .from("agent_actions")
      .select("id, summary, detail, target_id, created_at")
      .eq("agent_name", "workflow")
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("daily_reviews")
      .select("review_date, tomorrow_priorities")
      .order("review_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Onboarding signal (2.1's "what's going on" assumes there's
    // something to report) - unfiltered, unlike pendingCaptures/
    // openTasks/activeProjectsCount above, which only count a specific
    // status and would still read 0 for an account that has real but
    // e.g. all-completed content. "Has this account ever captured
    // anything at all" is the actual "brand new" signal.
    supabase.from("captures").select("*", { count: "exact", head: true }),
  ]);

  // Knowledge Reminder: "content resurfaced by relevance, not just
  // recency" - a note is relevant right now if it's linked to a project
  // that's still active, "resurfaced" if it's gone quiet (hasn't been
  // touched in two weeks) rather than just whatever's newest.
  //
  // relationships.source_id/target_id are polymorphic (Section 4: no FK
  // constraint, by design - they can point at any of six tables), so
  // PostgREST can't auto-embed through them the way projects/notes'
  // real foreign keys embed elsewhere on this page. Three plain queries,
  // joined in JS, instead of one embedded select that would 400 at
  // request time.
  const linkRows = await supabase
    .from("relationships")
    .select("source_id, target_id")
    .eq("source_type", "note")
    .eq("target_type", "project")
    .eq("relation_kind", "part_of")
    .limit(200);

  const noteIds = [...new Set((linkRows.data ?? []).map((r) => r.source_id))];
  const projectIds = [...new Set((linkRows.data ?? []).map((r) => r.target_id))];

  // Date.now() here is inherently a request-time read (this is an async
  // Server Component re-executed fresh per request, not a memoized
  // client render) - the compiler's purity check doesn't distinguish
  // that from a client component's render body, so it's disabled with
  // that context rather than worked around.
  // eslint-disable-next-line react-hooks/purity
  const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const [dormantNotes, linkedActiveProjects] = await Promise.all([
    noteIds.length
      ? supabase
          .from("notes")
          .select("id, title, updated_at")
          .in("id", noteIds)
          .lt("updated_at", fourteenDaysAgo)
      : Promise.resolve({ data: [] as { id: string; title: string; updated_at: string }[] }),
    projectIds.length
      ? supabase.from("projects").select("id, name").in("id", projectIds).eq("status", "active")
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);

  const stats = [
    { label: "Open tasks", value: openTasks.count ?? 0, href: "/tasks", icon: "check_box" },
    { label: "Pending captures", value: pendingCaptures.count ?? 0, href: "/inbox", icon: "inbox" },
    {
      label: "Active projects",
      value: activeProjectsCount.count ?? 0,
      href: "/projects",
      icon: "folder_special",
    },
  ];

  const focusTasks = (todaysBlocks.data ?? [])
    .map((b) => ({ blockId: b.id, ...(Array.isArray(b.tasks) ? b.tasks[0] : b.tasks) }))
    .filter((t) => t && t.status !== "done" && t.status !== "canceled");

  const projectsWithProgress = (activeProjects.data ?? []).map((p) => {
    const tasks = (p.tasks as { status: string }[]) ?? [];
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === "done").length;
    return { id: p.id, name: p.name, progress: total ? Math.round((done / total) * 100) : 0 };
  });

  const proposedAction = latestWorkflowProposal.data?.detail as
    | { proposed_action?: string }
    | null
    | undefined;

  // Pair each dormant note back up with whichever of its linked active
  // projects the relationships rows named, then surface the one that's
  // gone quietest the longest.
  const dormantNoteById = new Map((dormantNotes.data ?? []).map((n) => [n.id, n]));
  const activeProjectById = new Map((linkedActiveProjects.data ?? []).map((p) => [p.id, p]));
  const dormantCandidates = (linkRows.data ?? [])
    .map((r) => ({ note: dormantNoteById.get(r.source_id), project: activeProjectById.get(r.target_id) }))
    .filter((r): r is { note: NonNullable<typeof r.note>; project: NonNullable<typeof r.project> } =>
      Boolean(r.note && r.project),
    )
    .sort((a, b) => new Date(a.note.updated_at).getTime() - new Date(b.note.updated_at).getTime());
  const knowledgeReminder = dormantCandidates[0];
  // Zero captures ever, not just zero pending/open/active right now -
  // see the totalCapturesEver query comment above for why those two
  // aren't interchangeable signals.
  const isNewAccount = (totalCapturesEver.count ?? 0) === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold"><Trans id="welcomeBack" /></h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s going on in your second brain.
        </p>
      </div>

      {isNewAccount && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Icon name="auto_awesome" size={24} />
            </span>
            <div className="flex-1 space-y-1">
              <p className="font-heading text-base font-semibold">
                <Trans id="onboardingTitle" />
              </p>
              <p className="text-sm text-muted-foreground">
                <Trans id="onboardingBody" />
              </p>
            </div>
            <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
              <Link href="/inbox">
                <span className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-[var(--shadow-raised-sm)] transition-transform active:scale-95">
                  <Icon name="add" size={16} />
                  <Trans id="onboardingCapture" />
                </span>
              </Link>
              <Link href="/projects">
                <span className="flex items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition-transform hover:bg-muted active:scale-95">
                  <Icon name="folder_special" size={16} />
                  <Trans id="onboardingCreateProject" />
                </span>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="transition-colors hover:bg-muted/50">
              <CardContent className="flex items-center gap-3.5">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon name={stat.icon} size={20} />
                </span>
                <span className="flex flex-col">
                  <span className="font-heading text-2xl leading-none font-semibold text-primary">
                    {stat.value}
                  </span>
                  <span className="mt-1 text-sm text-muted-foreground">{stat.label}</span>
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Today's Focus */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Icon name="today" size={16} />
              Today&apos;s focus
            </CardTitle>
          </CardHeader>
          <CardContent>
            {focusTasks.length ? (
              <ul className="space-y-1">
                {focusTasks.map((t) => (
                  <li key={t.blockId} className="flex items-center gap-2">
                    <form action={toggleTaskDone}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="was_done" value="false" />
                      <button
                        type="submit"
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Mark done"
                      >
                        <Icon name="check_box_outline_blank" size={16} />
                      </button>
                    </form>
                    <Link href={`/tasks/${t.id}`} className="flex-1 truncate text-sm hover:underline">
                      {t.title}
                    </Link>
                    <PriorityBadge priority={t.priority} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing scheduled for today.</p>
            )}
          </CardContent>
        </Card>

        {/* Suggested Next Action */}
        <Card className={proposedAction ? "border-primary/30 bg-primary/5" : undefined}>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Icon name="auto_awesome" size={16} className={proposedAction ? "text-primary" : undefined} />
              Suggested next action
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestWorkflowProposal.data ? (
              <>
                <p className="text-sm text-foreground/90">
                  {latestWorkflowProposal.data.summary}
                  {proposedAction?.proposed_action && (
                    <span className="mt-1 block text-sm font-medium">
                      {proposedAction.proposed_action}
                    </span>
                  )}
                </p>
                <div className="flex gap-2">
                  <form action={confirmWorkflowProposal}>
                    <input type="hidden" name="id" value={latestWorkflowProposal.data.id} />
                    <FormSubmitButton
                      pendingText="Saving..."
                      className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground transition-transform active:scale-95"
                    >
                      Got it
                    </FormSubmitButton>
                  </form>
                  <form action={dismissWorkflowProposal}>
                    <input type="hidden" name="id" value={latestWorkflowProposal.data.id} />
                    <FormSubmitButton
                      pendingText="Dismissing..."
                      className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-transform hover:text-foreground active:scale-95"
                    >
                      Dismiss
                    </FormSubmitButton>
                  </form>
                  <Link
                    href="/projects"
                    className="ml-auto self-center text-xs font-medium text-primary hover:underline"
                  >
                    View project
                  </Link>
                </div>
              </>
            ) : (
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Icon name="check_circle" size={16} />
                Nothing flagged.{" "}
                <Link href="/projects" className="font-medium text-primary hover:underline">
                  Run a check
                </Link>
                .
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Active Projects with progress bars */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Active projects ({projectsWithProgress.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {projectsWithProgress.length ? (
              <ul className="space-y-2.5">
                {projectsWithProgress.map((p) => (
                  <li key={p.id}>
                    <Link href="/projects" className="flex items-center gap-2.5 hover:opacity-80">
                      <span className="w-28 shrink-0 truncate text-sm">{p.name}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${p.progress}%` }}
                        />
                      </div>
                      <span className="w-9 shrink-0 text-right text-xs text-muted-foreground">
                        {p.progress}%
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No active projects yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Overdue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Icon name="warning" size={16} className={overdueTasks.data?.length ? "text-destructive" : undefined} />
              Overdue ({overdueTasks.data?.length ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overdueTasks.data?.length ? (
              <ul className="space-y-1.5">
                {overdueTasks.data.map((t) => (
                  <li key={t.id} className="flex items-center gap-2">
                    <Link
                      href={`/tasks/${t.id}`}
                      className="flex-1 truncate text-sm font-medium text-destructive hover:underline"
                    >
                      {t.title}
                    </Link>
                    <PriorityBadge priority={t.priority} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Nothing overdue.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Recent Captures with processing status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent captures</CardTitle>
          </CardHeader>
          <CardContent>
            {recentCaptures.data?.length ? (
              <ul className="space-y-1.5">
                {recentCaptures.data.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <Icon
                      name={CAPTURE_ICON[c.kind] ?? "notes"}
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <span className="flex-1 truncate text-sm">
                      {c.raw_text || c.source_url || c.kind}
                    </span>
                    <Badge variant={CAPTURE_STATUS_VARIANT[c.status] ?? "muted"} className="text-[10px]">
                      {c.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon="inbox"
                title="Nothing captured yet"
                description="Drop something into the Inbox to get started."
              />
            )}
          </CardContent>
        </Card>

        {/* Knowledge Reminder */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              <Icon name="lightbulb" size={16} />
              Knowledge reminder
            </CardTitle>
          </CardHeader>
          <CardContent>
            {knowledgeReminder ? (
              <Link href={`/notes/${knowledgeReminder.note.id}`} className="block hover:opacity-80">
                <p className="text-sm text-foreground/90">
                  You haven&apos;t looked at{" "}
                  <span className="font-medium">{knowledgeReminder.note.title}</span> in a while -
                  still linked to <span className="font-medium">{knowledgeReminder.project.name}</span>,
                  might be worth another look.
                </p>
              </Link>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing dormant enough to resurface yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {latestDailyReview.data?.tomorrow_priorities?.length ? (
        <Card>
          <CardContent className="flex items-center gap-3">
            <Icon name="insights" size={18} className="shrink-0 text-primary" />
            <p className="flex-1 text-sm text-foreground/90">
              From{" "}
              {new Date(`${latestDailyReview.data.review_date}T00:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
              })}
              &apos;s review: {(latestDailyReview.data.tomorrow_priorities as string[])[0]}
            </p>
            <Link href="/reviews" className="shrink-0 text-xs font-medium text-primary hover:underline">
              See full review
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
