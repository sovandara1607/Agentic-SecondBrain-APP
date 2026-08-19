-- agent_actions was deliberately append-only (0001_initial_schema.sql:
-- "select and insert only, no update or delete, so a past action can't
-- be edited or erased after the fact") - no UPDATE policy existed at
-- all. The Dashboard's confirm/dismiss actions (apps/web/app/(app)/
-- dashboard/actions.ts) need a narrow, deliberate exception: a user
-- transitioning their OWN proposal's `status` between proposed /
-- confirmed / rejected, not rewriting what the agent actually did or
-- did for someone else.
--
-- Same column-scoped-grant trick as 0001's profiles/subscriptions
-- billing columns: the RLS policy scopes which ROWS are updatable
-- (own rows only), the column grant scopes which COLUMN is updatable
-- (status only) - summary/detail/agent_name/target_* etc. stay
-- genuinely immutable even though the row itself is no longer fully
-- append-only.
create policy "update own status" on agent_actions
  for update using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

revoke update on agent_actions from authenticated;
grant update (status) on agent_actions to authenticated;
