-- V2 roadmap (Section 17): "Public API: for users who want to script
-- their own capture sources." A long-lived personal access token,
-- distinct from the short-lived Supabase session JWT everything else in
-- the app uses, scoped narrowly to capture creation (apps/api/routers/
-- captures.py's POST /captures) - not a general-purpose replacement for
-- the JWT on every endpoint.
--
-- Only the token's SHA-256 hash is ever stored - the plaintext is shown
-- to the user exactly once, at creation time, generated client-side in
-- the Next.js server action and never sent to the database.
create table api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  token_prefix text not null, -- shown in the UI so a user can tell tokens apart without re-seeing the secret
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index api_tokens_user_idx on api_tokens (user_id);

-- apps/api's token-lookup path (core/auth.py) authenticates as the
-- service role (no per-request Supabase session to run this query as),
-- so it isn't RLS-scoped like everything else the running FastAPI
-- service does - the WHERE clause there does the scoping instead. RLS
-- below only governs the client-side CRUD (Settings page: create,
-- list, revoke), which does run as the authenticated user.
alter table api_tokens enable row level security;
create policy "select own rows" on api_tokens
  for select using (auth.uid() = user_id);
create policy "insert own rows" on api_tokens
  for insert with check (auth.uid() = user_id);
create policy "update own rows" on api_tokens
  for update using (auth.uid() = user_id);
create policy "delete own rows" on api_tokens
  for delete using (auth.uid() = user_id);
