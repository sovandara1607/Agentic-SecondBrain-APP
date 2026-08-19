-- Rich text editor image upload/paste (components/rich-text-editor.tsx).
-- Same private-bucket-with-folder-prefix-RLS pattern as `captures`
-- (0006_capture_storage.sql) - kept private rather than public because
-- this is a personal knowledge app (notes can contain sensitive
-- content), so embedded images are served back through an authenticated
-- proxy route (apps/web/app/api/notes/image/[...path]/route.ts) instead
-- of a public bucket URL baked into the note's stored markdown.
insert into storage.buckets (id, name, public)
values ('note-images', 'note-images', false)
on conflict (id) do nothing;

create policy "note-images: users manage their own objects"
on storage.objects for all
using (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'note-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
