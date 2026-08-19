-- tasks.status has been a plain `text` column with no DB-level
-- enforcement since 0001_initial_schema.sql, relying entirely on
-- application code writing one of the six documented values (open |
-- scheduled | in_progress | done | at_risk | canceled). That's exactly
-- what let calendar/page.tsx and calendar-actions.ts silently write/
-- filter on "inbox"/"todo" (values that were never real) for a stretch
-- of this project's history: no DB error, just a badge/scheduler/
-- Dashboard-count that quietly stopped matching reality. A CHECK
-- constraint makes that specific failure mode impossible going
-- forward, not just currently-absent - any future insert/update with a
-- typo'd or made-up status value now fails loudly at write time
-- instead of silently succeeding.
--
-- If this fails to apply, it means a row already has a value outside
-- this set - find it with:
--   select id, status from tasks where status not in
--     ('open','scheduled','in_progress','done','at_risk','canceled');
-- and fix the data (or the enum, if a real new state is actually
-- needed) before retrying, rather than loosening the constraint to fit
-- whatever's already there.
alter table tasks
  add constraint tasks_status_check
  check (status in ('open', 'scheduled', 'in_progress', 'done', 'at_risk', 'canceled'));
