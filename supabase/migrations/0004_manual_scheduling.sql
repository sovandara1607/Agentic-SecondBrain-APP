-- Manual scheduling: a task can now be given a specific start time/
-- duration directly (apps/web/app/(app)/tasks/actions.ts), bypassing the
-- automatic scheduler by writing time_blocks itself (a normal
-- authenticated-user write - time_blocks has the standard per-tenant RLS
-- policies, unlike jobs). Clearing that manual placement puts the task
-- back to status = 'open' so it re-enters the automatic scheduler's
-- candidate set on the next run.
--
-- 0003's on_task_created only fires on insert, so reopening an existing
-- task (clearing its manual schedule, or the missed-task pass releasing
-- it) never enqueued a new run_scheduler job - the task would just sit
-- open until something else happened to trigger a run. Narrow, targeted
-- fix: also fire on update specifically when status transitions to
-- 'open', not on every edit (toggling a task done, for instance,
-- shouldn't replan the whole queue).
create trigger on_task_reopened
  after update on tasks
  for each row
  when (old.status is distinct from 'open' and new.status = 'open')
  execute function public.enqueue_scheduler_run();
