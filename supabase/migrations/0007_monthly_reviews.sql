-- V2 roadmap (Section 17): "Monthly review: a rollup over weekly
-- reviews, straightforward once weekly review has real usage data to
-- validate the format against." A rollup, not a re-derivation - the
-- generator (ai_core/agents/review.py's generate_monthly_review) reads
-- weekly_reviews rows for the month, not tasks/notes/time_blocks
-- directly, so this table's shape mirrors what a month of
-- weekly_reviews aggregates into rather than daily_reviews' per-item
-- detail.
create table monthly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  month_start date not null, -- first of the month
  weeks_included integer not null default 0,
  project_progress jsonb not null default '[]', -- latest progress % per project seen that month
  knowledge_learned_count integer not null default 0,
  time_allocation jsonb not null default '{}', -- minutes by project, summed across the month's weeks
  missed_deadlines_count integer not null default 0,
  recommendations jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (user_id, month_start)
);

alter table monthly_reviews enable row level security;
create policy "select own rows" on monthly_reviews
  for select using (auth.uid() = user_id);
create policy "insert own rows" on monthly_reviews
  for insert with check (auth.uid() = user_id);
create policy "update own rows" on monthly_reviews
  for update using (auth.uid() = user_id);
create policy "delete own rows" on monthly_reviews
  for delete using (auth.uid() = user_id);
