-- Phase 2: enqueue a run_scheduler job whenever a task is created.
--
-- Same reasoning as 0002's on_capture_created: jobs has RLS enabled with
-- no policies, so the web app (writing as the authenticated user) can't
-- enqueue a job directly. A SECURITY DEFINER trigger does the one
-- privileged write a normal task-create action needs.
--
-- Deliberately insert-only for now, not also on update: re-triggering a
-- full replan on every deadline/status edit is a reasonable next step
-- but adds noise (e.g. toggling a task done would replan the whole
-- queue) that's worth its own consideration rather than bundling in
-- here. The missed-task pass (run on its own cadence, see worker/main.py)
-- already re-queues tasks whose scheduled block was missed.
create or replace function public.enqueue_scheduler_run()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.jobs (user_id, job_type, payload)
  values (new.user_id, 'run_scheduler', '{}'::jsonb);
  return new;
end;
$$;

create trigger on_task_created
  after insert on tasks
  for each row execute function public.enqueue_scheduler_run();
