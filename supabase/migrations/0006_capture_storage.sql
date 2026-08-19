-- Phase 1: the `captures` Storage bucket for voice/image/PDF originals
-- (Section 4/10: "Storage buckets: `captures` ... private, RLS via
-- Storage policies keyed to auth.uid() matching the path prefix").
--
-- Objects are always written under `{user_id}/...` by the upload route
-- (apps/web/app/api/capture/upload-url/route.ts), so a folder-prefix
-- check on storage.objects.name is sufficient to scope every operation
-- to its owner - same pattern Supabase's own docs use for private
-- per-user buckets.
insert into storage.buckets (id, name, public)
values ('captures', 'captures', false)
on conflict (id) do nothing;

create policy "captures: users manage their own objects"
on storage.objects for all
using (
  bucket_id = 'captures'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'captures'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- No policy needed for the worker's downloads during pipeline processing
-- (packages/ai_core/ai_core/storage.py): it reads via the service role
-- key, which bypasses Storage RLS the same way it bypasses table RLS
-- (Section 11 point 7) - the object path being user_id-prefixed is what
-- keeps that access correctly scoped in practice, not a policy.
