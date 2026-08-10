-- Phase 3: AI Workspace chat history. Not in the original Section 4
-- schema, but Section 3.5's user flow explicitly passes a conversation
-- id to the streaming endpoint, which needs somewhere to live.
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null, -- user | assistant
  content text not null,
  citations jsonb not null default '[]', -- [{content_type, content_id, title}]
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages (conversation_id, created_at);

-- Standard four-policy per-tenant pattern (both tables have their own
-- user_id column directly, same shape as 0001's generic loop - a fresh
-- block here rather than editing that already-applied one).
do $$
declare
  t text;
begin
  foreach t in array array['conversations', 'messages']
  loop
    execute format('alter table %I enable row level security;', t);
    execute format(
      'create policy "select own rows" on %I for select using (auth.uid() = user_id);', t
    );
    execute format(
      'create policy "insert own rows" on %I for insert with check (auth.uid() = user_id);', t
    );
    execute format(
      'create policy "update own rows" on %I for update using (auth.uid() = user_id);', t
    );
    execute format(
      'create policy "delete own rows" on %I for delete using (auth.uid() = user_id);', t
    );
  end loop;
end $$;
