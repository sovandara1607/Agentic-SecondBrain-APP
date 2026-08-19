-- Live Dashboard/Inbox updates: the self-hosted stack already runs
-- Supabase Realtime (infra/supabase/docker-compose.yml, routed through
-- Kong at /realtime/v1) and Kong is already configured for it - it was
-- just never wired to any table. Realtime's postgres_changes feature
-- only streams change events for tables explicitly added to the
-- `supabase_realtime` publication (confirmed empty: `select * from
-- pg_publication_tables where pubname = 'supabase_realtime'` returned
-- zero rows before this migration), and it authorizes each subscriber
-- against the same RLS policies already on these tables (Section 1's
-- defense-in-depth point again - a client can't subscribe to another
-- user's rows any more than they could SELECT them), so no new RLS is
-- needed here.
--
-- Scoped to the three tables that actually change from underneath an
-- open tab without the user doing anything in that tab: `captures` (the
-- pipeline walking pending -> processing -> organized/failed/needs_review
-- while Inbox is open, and Dashboard's Recent Captures list), `tasks`
-- (worker/main.py's run_missed_task_pass releasing a missed time block's
-- task back to 'open' on its own hourly schedule - Dashboard's Overdue/
-- Today's Focus cards read this), and `agent_actions` (the Workflow
-- agent's autonomous sweep - run_workflow_check_pass - dropping new
-- proposals onto the Dashboard on its own schedule). `projects`
-- deliberately left out: it only changes via an explicit action inside
-- the same tab today (no autonomous writer touches it), so there's
-- nothing to push.
alter publication supabase_realtime add table public.captures;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.agent_actions;
