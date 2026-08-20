import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/ui/icon";
import { DailyReviewButton } from "@/components/daily-review-button";
import { WeeklyReviewButton } from "@/components/weekly-review-button";
import { MonthlyReviewButton } from "@/components/monthly-review-button";
import { Trans } from "@/components/trans";

type ReviewItem = { id: string; title: string; reason?: string; status?: string };
type ProjectProgressItem = { id: string; name: string; progress: number; completed_this_week: number };
type MonthlyProjectProgressItem = { id: string; name: string; latest_progress: number; completed_this_month: number };

function Section<T>({
  icon,
  label,
  items,
  emptyLabel,
  render,
}: {
  icon: string;
  label: string;
  items: T[];
  emptyLabel: string;
  render: (item: T) => ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <Icon name={icon} size={14} />
        {label}
        <span className="font-normal normal-case text-muted-foreground/70">({items.length})</span>
      </h3>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((item, i) => (
            <li key={i} className="text-sm text-foreground/90">
              {render(item)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground italic">{emptyLabel}</p>
      )}
    </div>
  );
}

function mondayOf(d: Date): string {
  const day = d.getDay(); // 0 = Sunday
  const diff = (day === 0 ? -6 : 1) - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

export default async function ReviewsPage() {
  const supabase = await createClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const thisWeekStart = mondayOf(now);
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const [{ data: dailyReviews }, { data: weeklyReviews }, { data: monthlyReviews }] = await Promise.all([
    supabase
      .from("daily_reviews")
      .select(
        "id, review_date, completed_tasks, unfinished_tasks, new_knowledge, decisions, blockers, tomorrow_priorities",
      )
      .order("review_date", { ascending: false })
      .limit(14),
    supabase
      .from("weekly_reviews")
      .select(
        "id, week_start, project_progress, knowledge_learned, time_allocation, missed_deadlines, recommendations",
      )
      .order("week_start", { ascending: false })
      .limit(8),
    supabase
      .from("monthly_reviews")
      .select(
        "id, month_start, weeks_included, project_progress, knowledge_learned_count, time_allocation, missed_deadlines_count, recommendations",
      )
      .order("month_start", { ascending: false })
      .limit(6),
  ]);

  const hasToday = (dailyReviews ?? []).some((r) => r.review_date === today);
  const hasThisWeek = (weeklyReviews ?? []).some((r) => r.week_start === thisWeekStart);
  const hasThisMonth = (monthlyReviews ?? []).some((r) => r.month_start === thisMonthStart);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-heading text-2xl font-semibold"><Trans id="reviews" /></h1>
        <p className="text-sm text-muted-foreground">
          The Review agent reads your tasks, notes, and blockers, then suggests what to
          prioritize next.
        </p>
      </div>

      {/* Monthly Reviews */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">This month</h2>
          <MonthlyReviewButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} hasThisMonth={hasThisMonth} />
        </div>

        {monthlyReviews?.length ? (
          <div className="space-y-4">
            {monthlyReviews.map((review) => (
              <Card key={review.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>
                      {new Date(review.month_start + "T00:00:00").toLocaleDateString(undefined, {
                        month: "long",
                        year: "numeric",
                      })}
                    </span>
                    <span className="flex items-center gap-2">
                      <Badge variant="muted">
                        {review.weeks_included} week{review.weeks_included === 1 ? "" : "s"} rolled up
                      </Badge>
                      {review.month_start === thisMonthStart && <Badge variant="muted">This month</Badge>}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(review.recommendations as string[])?.length ? (
                    <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                        <Icon name="insights" size={14} />
                        Recommendations
                      </h3>
                      <ul className="list-disc space-y-1 pl-4">
                        {(review.recommendations as string[]).map((r, i) => (
                          <li key={i} className="text-sm text-foreground/90">
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <Icon name="trending_up" size={14} />
                      Project progress
                    </h3>
                    {(review.project_progress as MonthlyProjectProgressItem[])?.length ? (
                      <ul className="space-y-2">
                        {(review.project_progress as MonthlyProjectProgressItem[]).map((p) => (
                          <li key={p.id} className="flex items-center gap-2.5">
                            <span className="w-32 shrink-0 truncate text-sm">{p.name}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${p.latest_progress}%` }}
                              />
                            </div>
                            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                              {p.latest_progress}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No project activity this month.</p>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Icon name="description" size={14} />
                      {review.knowledge_learned_count} note{review.knowledge_learned_count === 1 ? "" : "s"}{" "}
                      captured
                    </span>
                    <span className="flex items-center gap-1">
                      <Icon name="event_busy" size={14} />
                      {review.missed_deadlines_count} missed deadline
                      {review.missed_deadlines_count === 1 ? "" : "s"}
                    </span>
                  </div>

                  {Object.keys((review.time_allocation as Record<string, number>) ?? {}).length ? (
                    <div className="space-y-1.5">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <Icon name="schedule" size={14} />
                        Time allocation
                      </h3>
                      <ul className="flex flex-wrap gap-1.5">
                        {Object.entries(review.time_allocation as Record<string, number>).map(
                          ([name, minutes]) => (
                            <Badge key={name} variant="muted" className="text-xs">
                              {name}: {Math.round((minutes / 60) * 10) / 10}h
                            </Badge>
                          ),
                        )}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="calendar_view_month"
            title="No monthly reviews yet"
            description="Generate this month's rollup once you have at least one weekly review to aggregate."
          />
        )}
      </div>

      {/* Weekly Reviews */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">This week</h2>
          <WeeklyReviewButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} hasThisWeek={hasThisWeek} />
        </div>

        {weeklyReviews?.length ? (
          <div className="space-y-4">
            {weeklyReviews.map((review) => (
              <Card key={review.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>
                      Week of{" "}
                      {new Date(review.week_start + "T00:00:00").toLocaleDateString(undefined, {
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    {review.week_start === thisWeekStart && <Badge variant="muted">This week</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(review.recommendations as string[])?.length ? (
                    <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                        <Icon name="insights" size={14} />
                        Recommendations
                      </h3>
                      <ul className="list-disc space-y-1 pl-4">
                        {(review.recommendations as string[]).map((r, i) => (
                          <li key={i} className="text-sm text-foreground/90">
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="space-y-1.5">
                    <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <Icon name="trending_up" size={14} />
                      Project progress
                    </h3>
                    {(review.project_progress as ProjectProgressItem[])?.length ? (
                      <ul className="space-y-2">
                        {(review.project_progress as ProjectProgressItem[]).map((p) => (
                          <li key={p.id} className="flex items-center gap-2.5">
                            <span className="w-32 shrink-0 truncate text-sm">{p.name}</span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${p.progress}%` }}
                              />
                            </div>
                            <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">
                              {p.progress}%
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No project activity this week.</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Section
                      icon="description"
                      label="Knowledge learned"
                      items={(review.knowledge_learned as ReviewItem[]) ?? []}
                      emptyLabel="No new notes."
                      render={(n: ReviewItem) => n.title}
                    />
                    <Section
                      icon="event_busy"
                      label="Missed deadlines"
                      items={(review.missed_deadlines as ReviewItem[]) ?? []}
                      emptyLabel="Nothing missed."
                      render={(d: ReviewItem) => d.title}
                    />
                  </div>

                  {Object.keys((review.time_allocation as Record<string, number>) ?? {}).length ? (
                    <div className="space-y-1.5">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        <Icon name="schedule" size={14} />
                        Time allocation
                      </h3>
                      <ul className="flex flex-wrap gap-1.5">
                        {Object.entries(review.time_allocation as Record<string, number>).map(
                          ([name, minutes]) => (
                            <Badge key={name} variant="muted" className="text-xs">
                              {name}: {Math.round(minutes / 60 * 10) / 10}h
                            </Badge>
                          ),
                        )}
                      </ul>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="insights"
            title="No weekly reviews yet"
            description="Generate this week's review to see project progress, time allocation, and recommendations."
          />
        )}
      </div>

      {/* Daily Reviews */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-heading text-lg font-semibold">Daily</h2>
          <DailyReviewButton apiUrl={process.env.NEXT_PUBLIC_API_URL!} hasToday={hasToday} />
        </div>

        {dailyReviews?.length ? (
          <div className="space-y-4">
            {dailyReviews.map((review) => (
              <Card key={review.id}>
                <CardHeader>
                  <CardTitle className="flex items-center justify-between gap-2">
                    <span>
                      {new Date(review.review_date + "T00:00:00").toLocaleDateString(undefined, {
                        weekday: "long",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                    {review.review_date === today && <Badge variant="muted">Today</Badge>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(review.tomorrow_priorities as string[])?.length ? (
                    <div className="space-y-1.5 rounded-lg border border-primary/20 bg-primary/5 p-3">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-primary uppercase tracking-wider">
                        <Icon name="auto_awesome" size={14} />
                        Tomorrow&apos;s priorities
                      </h3>
                      <ul className="list-disc space-y-1 pl-4">
                        {(review.tomorrow_priorities as string[]).map((p, i) => (
                          <li key={i} className="text-sm text-foreground/90">
                            {p}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <Section
                      icon="check_circle"
                      label="Completed"
                      items={(review.completed_tasks as ReviewItem[]) ?? []}
                      emptyLabel="Nothing marked done."
                      render={(t: ReviewItem) => t.title}
                    />
                    <Section
                      icon="pending_actions"
                      label="Still open"
                      items={(review.unfinished_tasks as ReviewItem[]) ?? []}
                      emptyLabel="Nothing left hanging."
                      render={(t: ReviewItem) => t.title}
                    />
                    <Section
                      icon="description"
                      label="New knowledge"
                      items={(review.new_knowledge as ReviewItem[]) ?? []}
                      emptyLabel="No new notes."
                      render={(n: ReviewItem) => n.title}
                    />
                    <Section
                      icon="gavel"
                      label="Decisions"
                      items={(review.decisions as ReviewItem[]) ?? []}
                      emptyLabel="No decisions logged."
                      render={(d: ReviewItem) => d.title}
                    />
                  </div>

                  {(review.blockers as ReviewItem[])?.length ? (
                    <Section
                      icon="warning"
                      label="Blockers"
                      items={(review.blockers as ReviewItem[]) ?? []}
                      emptyLabel=""
                      render={(b: ReviewItem) => (
                        <span className="flex items-center gap-1.5">
                          {b.title}
                          <Badge variant="muted" className="text-[10px]">
                            {b.reason === "missed" ? "missed slot" : "at risk"}
                          </Badge>
                        </span>
                      )}
                    />
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon="auto_awesome"
            title="No reviews yet"
            description="Generate today's review to see completed work, open items, and tomorrow's priorities."
          />
        )}
      </div>
    </div>
  );
}
