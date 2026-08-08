create extension if not exists vector;
create extension if not exists pg_trgm;

-- Profiles extends auth.users
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  subscription_tier text not null default 'free', -- free | pro | team
  working_hours jsonb not null default '{"start":"09:00","end":"18:00","days":[1,2,3,4,5]}',
  energy_profile jsonb not null default '{"morning":"high","afternoon":"medium","evening":"low"}',
  scheduler_weights jsonb not null default '{"urgency":0.5,"priority":0.3,"project_weight":0.2}',
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  status text not null default 'inactive', -- inactive | active | past_due | canceled
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  overview text,
  goals text,
  status text not null default 'active', -- active | paused | completed | archived
  progress numeric not null default 0, -- derived, recomputed on task changes
  ai_summary text,
  ai_summary_updated_at timestamptz,
  risks jsonb not null default '[]',
  start_date date,
  target_date date,
  depends_on_project_id uuid references projects(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table captures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null, -- text | voice | image | pdf | url | meeting_note
  raw_text text,
  storage_path text, -- Supabase Storage path for voice/image/pdf
  source_url text,
  status text not null default 'pending', -- pending | processing | organized | needs_review | failed
  pipeline_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  capture_id uuid references captures(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  content text not null, -- markdown
  note_type text not null default 'note', -- note | meeting | decision | summary
  ai_summary text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  note_id uuid not null references notes(id) on delete cascade,
  occurred_at timestamptz not null,
  attendee_entity_ids uuid[] not null default '{}'
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  capture_id uuid references captures(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  title text not null,
  storage_path text not null,
  mime_type text not null,
  extracted_text text,
  created_at timestamptz not null default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  project_id uuid references projects(id) on delete set null,
  capture_id uuid references captures(id) on delete set null,
  title text not null,
  context text,
  status text not null default 'open', -- open | scheduled | in_progress | done | at_risk | canceled
  priority smallint not null default 3, -- 1 highest .. 5 lowest
  energy_level text not null default 'medium', -- low | medium | high
  estimated_minutes integer not null default 30,
  deadline timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table task_dependencies (
  task_id uuid not null references tasks(id) on delete cascade,
  depends_on_task_id uuid not null references tasks(id) on delete cascade,
  primary key (task_id, depends_on_task_id)
);

create table time_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  task_id uuid not null references tasks(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'scheduled' -- scheduled | completed | missed | released
);

create table entities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null, -- person | concept | organization
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table relationships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source_type text not null, -- project | note | task | document | meeting | entity
  source_id uuid not null,
  target_type text not null,
  target_id uuid not null,
  relation_kind text not null, -- mentions | relates_to | blocks | part_of | attended_by | decided_in | authored_by | references
  weight numeric not null default 1.0, -- similarity score when relation_kind = 'relates_to'
  created_at timestamptz not null default now()
);
create index relationships_source_idx on relationships (user_id, source_type, source_id);
create index relationships_target_idx on relationships (user_id, target_type, target_id);

create table embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  content_type text not null, -- note | task | project | document | meeting
  content_id uuid not null,
  chunk_index integer not null default 0,
  chunk_text text not null,
  embedding vector(768) not null,
  created_at timestamptz not null default now()
);
create index embeddings_vector_idx on embeddings using hnsw (embedding vector_cosine_ops);
create index embeddings_content_idx on embeddings (user_id, content_type, content_id);

create table daily_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  review_date date not null,
  completed_tasks jsonb not null default '[]',
  unfinished_tasks jsonb not null default '[]',
  new_knowledge jsonb not null default '[]',
  decisions jsonb not null default '[]',
  blockers jsonb not null default '[]',
  tomorrow_priorities jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (user_id, review_date)
);

create table weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start date not null,
  project_progress jsonb not null default '[]',
  knowledge_learned jsonb not null default '[]',
  time_allocation jsonb not null default '{}',
  missed_deadlines jsonb not null default '[]',
  recommendations jsonb not null default '[]',
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);

create table agent_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  agent_name text not null, -- memory | planner | research | writer | review | workflow | pipeline
  action_kind text not null, -- created | updated | suggested | answered
  target_type text,
  target_id uuid,
  summary text not null,
  detail jsonb,
  status text not null default 'applied', -- applied | proposed | confirmed | rejected
  created_at timestamptz not null default now()
);

create table tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  unique (user_id, name)
);

create table taggables (
  tag_id uuid not null references tags(id) on delete cascade,
  taggable_type text not null, -- note | task | project | document
  taggable_id uuid not null,
  primary key (tag_id, taggable_type, taggable_id)
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  job_type text not null, -- process_capture | run_scheduler | missed_task_pass | daily_review | weekly_review
  payload jsonb not null default '{}',
  status text not null default 'queued', -- queued | running | done | failed
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index jobs_ready_idx on jobs (status, run_at);

-- Auto-provision a profile row whenever a user signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row level security, standard four-policy pattern per tenant table.
-- profiles is deliberately excluded from this array: it has no user_id
-- column (its id IS the user id), so the generic 'auth.uid() = user_id'
-- policies below would fail against it. It gets its own two-policy
-- treatment in the dedicated "profiles is special" block further down.
-- agent_actions, relationships, and embeddings are also excluded: each
-- needs stricter-than-standard policies (append-only, or cross-reference
-- ownership validation) and gets its own dedicated block further down.
do $$
declare
  t text;
begin
  foreach t in array array[
    'subscriptions', 'projects', 'captures', 'notes',
    'meetings', 'documents', 'tasks', 'time_blocks', 'entities',
    'daily_reviews', 'weekly_reviews', 'tags'
  ]
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

-- profiles is special: id IS the user id, not a separate user_id column.
-- It was never in the loop above, so there are no generic policies to
-- drop here first -- just enable RLS and add its own two policies.
alter table profiles enable row level security;
create policy "select own row" on profiles for select using (auth.uid() = id);
create policy "update own row" on profiles for update using (auth.uid() = id);
-- no insert/delete policy on profiles: rows are created only by the
-- handle_new_user trigger (security definer) and never deleted directly

-- agent_actions is an append-only audit log of what agents did: select
-- and insert only, no update or delete, so a past action can't be edited
-- or erased after the fact.
alter table agent_actions enable row level security;
create policy "select own rows" on agent_actions
  for select using (auth.uid() = user_id);
create policy "insert own rows" on agent_actions
  for insert with check (auth.uid() = user_id);

-- Junction tables without a user_id column, scoped through their parent.
-- task_dependencies' insert also validates that depends_on_task_id (not
-- just task_id) belongs to the same user, so a task can't be wired up to
-- depend on -- or be depended on by -- another tenant's task.
alter table task_dependencies enable row level security;
create policy "select own rows" on task_dependencies
  for select using (exists (
    select 1 from tasks t where t.id = task_dependencies.task_id and t.user_id = auth.uid()
  ));
create policy "insert own rows" on task_dependencies
  for insert with check (
    exists (
      select 1 from tasks t where t.id = task_dependencies.task_id and t.user_id = auth.uid()
    )
    and exists (
      select 1 from tasks t2 where t2.id = task_dependencies.depends_on_task_id and t2.user_id = auth.uid()
    )
  );
create policy "delete own rows" on task_dependencies
  for delete using (exists (
    select 1 from tasks t where t.id = task_dependencies.task_id and t.user_id = auth.uid()
  ));

-- taggables' insert also validates ownership of the tagged row itself
-- (taggable_id), branching on taggable_type, so a tag can't be attached
-- to another tenant's note/task/project/document.
alter table taggables enable row level security;
create policy "select own rows" on taggables
  for select using (exists (
    select 1 from tags tg where tg.id = taggables.tag_id and tg.user_id = auth.uid()
  ));
create policy "insert own rows" on taggables
  for insert with check (
    exists (select 1 from tags tg where tg.id = taggables.tag_id and tg.user_id = auth.uid())
    and case taggables.taggable_type
      when 'note' then exists (select 1 from notes n where n.id = taggables.taggable_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = taggables.taggable_id and t.user_id = auth.uid())
      when 'project' then exists (select 1 from projects p where p.id = taggables.taggable_id and p.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = taggables.taggable_id and d.user_id = auth.uid())
      else false
    end
  );
create policy "delete own rows" on taggables
  for delete using (exists (
    select 1 from tags tg where tg.id = taggables.tag_id and tg.user_id = auth.uid()
  ));

-- relationships cross-references two arbitrary rows (source/target), so
-- insert/update must also validate ownership of both endpoints, branching
-- on source_type/target_type, not just ownership of the relationships row
-- itself -- otherwise a tenant could link their own row to another
-- tenant's row.
alter table relationships enable row level security;
create policy "select own rows" on relationships
  for select using (auth.uid() = user_id);
create policy "insert own rows" on relationships
  for insert with check (
    auth.uid() = user_id
    and case relationships.source_type
      when 'project' then exists (select 1 from projects p where p.id = relationships.source_id and p.user_id = auth.uid())
      when 'note' then exists (select 1 from notes n where n.id = relationships.source_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = relationships.source_id and t.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = relationships.source_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = relationships.source_id and m.user_id = auth.uid())
      when 'entity' then exists (select 1 from entities e where e.id = relationships.source_id and e.user_id = auth.uid())
      else false
    end
    and case relationships.target_type
      when 'project' then exists (select 1 from projects p where p.id = relationships.target_id and p.user_id = auth.uid())
      when 'note' then exists (select 1 from notes n where n.id = relationships.target_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = relationships.target_id and t.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = relationships.target_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = relationships.target_id and m.user_id = auth.uid())
      when 'entity' then exists (select 1 from entities e where e.id = relationships.target_id and e.user_id = auth.uid())
      else false
    end
  );
create policy "update own rows" on relationships
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and case relationships.source_type
      when 'project' then exists (select 1 from projects p where p.id = relationships.source_id and p.user_id = auth.uid())
      when 'note' then exists (select 1 from notes n where n.id = relationships.source_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = relationships.source_id and t.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = relationships.source_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = relationships.source_id and m.user_id = auth.uid())
      when 'entity' then exists (select 1 from entities e where e.id = relationships.source_id and e.user_id = auth.uid())
      else false
    end
    and case relationships.target_type
      when 'project' then exists (select 1 from projects p where p.id = relationships.target_id and p.user_id = auth.uid())
      when 'note' then exists (select 1 from notes n where n.id = relationships.target_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = relationships.target_id and t.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = relationships.target_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = relationships.target_id and m.user_id = auth.uid())
      when 'entity' then exists (select 1 from entities e where e.id = relationships.target_id and e.user_id = auth.uid())
      else false
    end
  );
create policy "delete own rows" on relationships
  for delete using (auth.uid() = user_id);

-- embeddings.content_id is a polymorphic reference, so insert/update must
-- also validate ownership of the referenced content row, branching on
-- content_type, not just ownership of the embeddings row itself.
alter table embeddings enable row level security;
create policy "select own rows" on embeddings
  for select using (auth.uid() = user_id);
create policy "insert own rows" on embeddings
  for insert with check (
    auth.uid() = user_id
    and case embeddings.content_type
      when 'note' then exists (select 1 from notes n where n.id = embeddings.content_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = embeddings.content_id and t.user_id = auth.uid())
      when 'project' then exists (select 1 from projects p where p.id = embeddings.content_id and p.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = embeddings.content_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = embeddings.content_id and m.user_id = auth.uid())
      else false
    end
  );
create policy "update own rows" on embeddings
  for update using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and case embeddings.content_type
      when 'note' then exists (select 1 from notes n where n.id = embeddings.content_id and n.user_id = auth.uid())
      when 'task' then exists (select 1 from tasks t where t.id = embeddings.content_id and t.user_id = auth.uid())
      when 'project' then exists (select 1 from projects p where p.id = embeddings.content_id and p.user_id = auth.uid())
      when 'document' then exists (select 1 from documents d where d.id = embeddings.content_id and d.user_id = auth.uid())
      when 'meeting' then exists (select 1 from meetings m where m.id = embeddings.content_id and m.user_id = auth.uid())
      else false
    end
  );
create policy "delete own rows" on embeddings
  for delete using (auth.uid() = user_id);

-- jobs: RLS enabled, no policies, only the service role (which bypasses
-- RLS) may read or write
alter table jobs enable row level security;

-- Billing/subscription columns: block tenant self-escalation. RLS only
-- restricts which rows a tenant can touch, not which columns -- without
-- this, an authenticated user could UPDATE their own profiles/subscriptions
-- row (which the policies above allow) to set subscription_tier to 'pro'
-- or flip a subscription to 'active' directly, bypassing billing.
--
-- This stack's base image already grants table-level UPDATE on every
-- public table to authenticated (and anon) via default privileges. A
-- column-scoped REVOKE has no effect on top of that: Postgres computes
-- column access as table-level-grant OR column-level-grant, so the
-- pre-existing table-wide UPDATE would still permit writing the
-- "restricted" columns (confirmed empirically while verifying this
-- migration). The only way to actually restrict specific columns is to
-- revoke the table-level UPDATE entirely, then re-grant UPDATE
-- column-by-column for whatever a tenant should still be able to edit
-- themselves. Only the service role (used by the billing webhook, which
-- bypasses RLS and grants alike) may still write the billing columns.
revoke update on profiles from authenticated;
grant update (full_name, working_hours, energy_profile, scheduler_weights) on profiles to authenticated;

revoke update on subscriptions from authenticated;
-- no columns re-granted: every mutable column on subscriptions
-- (status, stripe_customer_id, stripe_subscription_id, current_period_end)
-- is billing-controlled; a tenant has no legitimate column to self-update
-- on their own subscription row.
