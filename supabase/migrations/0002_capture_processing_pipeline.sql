-- Phase 1: enqueue a process_capture job whenever a capture is created.
--
-- jobs has RLS enabled with no policies (0001_initial_schema.sql: "only
-- the service role... may read or write"), so the web app - which writes
-- captures as the authenticated user, not service_role - cannot insert
-- into jobs directly. Same shape as handle_new_user: a SECURITY DEFINER
-- trigger bypasses RLS to do the one privileged write a normal user
-- action needs, without ever handing the app itself broader access.
create or replace function public.enqueue_capture_processing()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.jobs (user_id, job_type, payload)
  values (new.user_id, 'process_capture', jsonb_build_object('capture_id', new.id));
  return new;
end;
$$;

create trigger on_capture_created
  after insert on captures
  for each row execute function public.enqueue_capture_processing();
