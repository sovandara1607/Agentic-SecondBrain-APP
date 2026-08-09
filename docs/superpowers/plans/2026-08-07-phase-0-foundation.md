# Phase 0, Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the full monorepo skeleton, self-hosted Supabase (Postgres, Auth, Storage, Realtime), the complete database schema with RLS, working end-to-end authentication (signup, login, session), a FastAPI service that verifies Supabase-issued JWTs, a worker that can claim and complete jobs, and a Docker Compose stack that runs all of it together.

**Architecture:** Next.js talks to Supabase directly for CRUD (protected by RLS), FastAPI is a separate Python service that verifies the caller's JWT and will host the AI pipeline/agents starting in Phase 1, a Python worker polls a Postgres-backed `jobs` table. All three (`web`, `api`, `worker`) plus the self-hosted Supabase stack run under one Docker Compose setup behind a Caddy reverse proxy. This plan produces no AI pipeline logic yet (that is Phase 1), it produces the substrate everything else is built on.

**Tech Stack:** Next.js (App Router, TypeScript, Tailwind, shadcn/ui), `@supabase/ssr`, FastAPI + Uvicorn, `uv` for Python dependency/workspace management, PyJWT, `psycopg` (v3), self-hosted Supabase (Postgres + pgvector, GoTrue, PostgREST, Storage, Realtime, Kong), Docker Compose, Caddy.

## Global Constraints

- Monorepo layout follows the design spec's Section 8 folder structure, with one disclosed refinement: `packages/ai_core`'s importable Python package lives at `packages/ai_core/ai_core/` (a project dir containing an inner import package of the same name), which is the standard layout for a `hatchling`-built local package, the spec's listing was schematic and did not intend a flat un-packageable directory.
- JWT verification uses the shared `JWT_SECRET` (HS256), synced across GoTrue/PostgREST/Realtime/Kong/FastAPI, per the corrected Section 11 of the spec. Do not implement JWKS/asymmetric verification, that is v2 scope.
- Every tenant-owned table gets RLS enabled with the four-policy pattern (select/insert/update/delete scoped to `auth.uid() = user_id`) from spec Section 4, except `jobs` (RLS enabled, no policies, service-role only) and the two pure junction tables without a `user_id` column (`task_dependencies`, `taggables`), which scope RLS through an `exists` subquery against their parent table.
- Git commits in every step use plain `git commit -m "..."` with no identity overrides and no AI co-author trailer (this machine's global git config, `srith <srith3@paragoniu.edu.kh>`, is correct as-is).
- No pipeline, agent, or scheduling logic is written in this plan, `packages/ai_core` is scaffolded as an empty installable package only. Phase 1's plan adds real content to it.

---

## File Structure

```
agentic-second-brain/
  pyproject.toml                        # uv workspace root
  .gitignore
  .env.example
  README.md
  apps/
    web/                                 # Next.js app (Task 4-6)
      ...(standard create-next-app output, extended in Task 5-6)
    api/                                 # FastAPI app (Task 7-8)
      pyproject.toml
      main.py
      core/config.py
      core/auth.py
      routers/health.py
      routers/me.py
      tests/test_auth.py
      tests/test_health.py
      Dockerfile
  packages/
    ai_core/
      pyproject.toml
      ai_core/__init__.py
  worker/
    pyproject.toml
    main.py
    tests/test_jobs.py
    Dockerfile
  supabase/
    migrations/
      0001_initial_schema.sql
  infra/
    supabase/                            # vendored self-hosted Supabase stack (Task 2)
    docker-compose.yml                   # our services + include: infra/supabase (Task 10)
    Caddyfile
  docs/
    superpowers/
      specs/2026-08-07-agentic-second-brain-design.md
      plans/2026-08-07-phase-0-foundation.md
```

---

### Task 1: Monorepo root scaffold and Python workspace

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `pyproject.toml`
- Create: `packages/ai_core/pyproject.toml`
- Create: `packages/ai_core/ai_core/__init__.py`
- Create: `worker/pyproject.toml`
- Create: `worker/main.py`

**Interfaces:**
- Produces: an installable local package `ai_core` (version `ai_core.__version__: str`) that `apps/api` and `worker` depend on by name via the uv workspace.
- Produces: a root `uv` workspace so `uv sync` from repo root installs every member's dependencies into one shared virtual environment.

- [ ] **Step 1: Write the root `.gitignore`**

```
__pycache__/
*.pyc
.venv/
.env
node_modules/
.next/
dist/
build/
*.egg-info/
.pytest_cache/
.DS_Store
```

- [ ] **Step 2: Write the root `.env.example`**

```bash
# Supabase (self-hosted, see infra/supabase for the full generated set)
SUPABASE_URL=http://localhost:8000
POSTGRES_PASSWORD=replace-with-generated-password
JWT_SECRET=replace-with-generated-32-char-secret
ANON_KEY=replace-with-generated-anon-key
SERVICE_ROLE_KEY=replace-with-generated-service-role-key

# Direct Postgres connection, used by FastAPI and the worker
DATABASE_URL=postgresql://postgres:replace-with-generated-password@localhost:5432/postgres

# Next.js (public, safe to expose to the browser)
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=replace-with-generated-anon-key
NEXT_PUBLIC_API_URL=http://localhost:8001
```

- [ ] **Step 3: Write the root `README.md`**

```markdown
# Agentic Second Brain

An agentic personal knowledge and workflow system. See
`docs/superpowers/specs/2026-08-07-agentic-second-brain-design.md`
for the full product and architecture blueprint.

## Local development

1. Copy `.env.example` to `.env` and fill in real values (Phase 0 plan,
   Task 2, generates the Supabase secrets).
2. Bring up the self-hosted Supabase stack: see `infra/supabase/README.md`.
3. Apply database migrations: see `supabase/migrations/`.
4. Install Python dependencies for the API and worker: `uv sync`.
5. Install and run the web app: `cd apps/web && npm install && npm run dev`.
6. Run the full stack in Docker: `docker compose -f infra/docker-compose.yml up --build`.
```

- [ ] **Step 4: Write the root uv workspace `pyproject.toml`**

```toml
[project]
name = "agentic-second-brain"
version = "0.1.0"
requires-python = ">=3.12"

[tool.uv.workspace]
members = ["apps/api", "worker", "packages/ai_core"]
```

- [ ] **Step 5: Scaffold the `ai_core` shared package**

Create `packages/ai_core/pyproject.toml`:

```toml
[project]
name = "ai-core"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = []

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["ai_core"]
```

Create `packages/ai_core/ai_core/__init__.py`:

```python
"""Shared AI pipeline and agent code, used by both the FastAPI service
and the background worker. Phase 1 adds the capture pipeline here,
Phase 3 adds the six agent graphs. Empty in Phase 0 by design."""

__version__ = "0.1.0"
```

- [ ] **Step 6: Scaffold the `worker` package (dependencies only, logic comes in Task 9)**

Create `worker/pyproject.toml`:

```toml
[project]
name = "second-brain-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "psycopg[binary]>=3.2",
    "ai-core",
]

[tool.uv.sources]
ai-core = { workspace = true }

[tool.uv]
package = false
```

Create a placeholder `worker/main.py` (replaced with real polling logic in Task 9):

```python
def main() -> None:
    print("worker: scaffold placeholder, see Task 9 for the real polling loop")


if __name__ == "__main__":
    main()
```

- [ ] **Step 7: Verify the workspace installs**

Run: `uv sync --all-packages`
Expected: completes without error, creates `.venv/` at the repo root, and `uv run python -c "import ai_core; print(ai_core.__version__)"` prints `0.1.0`.

Plain `uv sync` only installs the root project's own dependencies plus whatever workspace members those dependencies pull in transitively, since nothing in this repo depends on `ai_core` or `worker` yet (that starts in Task 7 and Task 9), plain `uv sync` will not install them. `--all-packages` explicitly syncs every declared workspace member regardless of whether the root depends on it, which is what this verification (and every later task's `uv sync`) actually needs. Do not substitute a manual `uv pip install -e ... --no-deps` workaround, that bypasses `uv.lock` and defeats reproducible installs, which is the entire point of using `uv`.

- [ ] **Step 8: Commit**

```bash
git add .gitignore .env.example README.md pyproject.toml packages/ worker/ uv.lock
git commit -m "Scaffold monorepo root and Python uv workspace"
```

---

### Task 2: Vendor and configure the self-hosted Supabase stack

**Files:**
- Create: `infra/supabase/` (vendored from `supabase/supabase`'s `docker/` folder, contents not enumerated here since they come from the upstream repo)
- Create: `infra/supabase/.env` (generated, gitignored)

**Interfaces:**
- Produces: a running Postgres reachable at `localhost:5432` (user `postgres`, database `postgres`), Kong API gateway at `localhost:8000`, and the values `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`, `POSTGRES_PASSWORD` that every later task's `.env` files are filled in from.

- [ ] **Step 1: Add `infra/supabase/` (and any future vendor drops) to `.gitignore`'s exception list**

The vendored stack is tracked in git (it's configuration, not a build artifact), but its generated `.env` must never be committed:

Add to `.gitignore`:
```
infra/supabase/.env
```

- [ ] **Step 2: Clone the self-hosted release and copy the docker folder into place**

```bash
git clone --depth 1 --branch self-hosted/v0.7.2 https://github.com/supabase/supabase /tmp/supabase-vendor
mkdir -p infra/supabase
cp -rf /tmp/supabase-vendor/docker/. infra/supabase/
rm -rf /tmp/supabase-vendor
```

- [ ] **Step 3: Generate real secrets (not the shipped demo values)**

```bash
cd infra/supabase
cp .env.example .env
sh utils/generate-keys.sh
sh utils/add-new-auth-keys.sh
cd ../..
```

This populates `infra/supabase/.env` with a real `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, and `SERVICE_ROLE_KEY`, matched to each other.

**Self-correction (found during Task 8, fixed 2026-08-09):** run non-interactively with `--update-env` (required so the scripts actually write into `.env` instead of only printing — see Task 2's report), `utils/add-new-auth-keys.sh` also uncommented `GOTRUE_JWT_KEYS` (and the parallel `API_JWT_JWKS`/`JWT_JWKS`/`SUPABASE_JWKS` lines for storage/realtime/studio) in `infra/supabase/docker-compose.yml` and populated `JWT_KEYS` in `.env` with an EC (`ES256`) signing key listed *before* the legacy HS256 (`oct`) key. GoTrue picks its active *signing* key from that list, so it started issuing `ES256`-signed access tokens for real sign-ins — silently, since nothing in Tasks 2-7 decoded a real token's header. This directly contradicted the MVP decision already on record (commit `31738c9`, predating this task's execution): self-hosted Supabase auth here uses the shared `HS256` secret, not JWKS/asymmetric keys. The drift surfaced in Task 8, the first task to verify `/me` against a real GoTrue-issued token (see Task 8's report for the discovery and the `ES256`/`HS256` header diff).

**Fix:** commented the `GOTRUE_JWT_KEYS: ${JWT_KEYS:-[]}` line back out in the `auth` service's environment block in `infra/supabase/docker-compose.yml` (with an explanatory comment in place), then recreated the container (`docker compose up -d auth` from `infra/supabase` — a plain `restart` does *not* pick up compose-file env changes on an already-created container). Left `JWT_KEYS`/`JWT_JWKS` untouched in `.env` and left `API_JWT_JWKS`/`JWT_JWKS`/`SUPABASE_JWKS` untouched in `docker-compose.yml` for the `rest`/`storage`/`realtime`/`studio` services — those still resolve to the JWKS value (which includes the legacy `oct`/`HS256` key alongside the now-inactive EC key), so they keep verifying tokens correctly without any changes; only GoTrue's own signing-key preference needed reverting.

**Verification (Task 8):** a fresh password-grant token for the Task 6 test user now decodes to `{"alg": "HS256", "typ": "JWT"}` (previously `{"alg": "ES256", ...}`). `GET /me` with that real token returns `200 {"user_id":"b353df4f-8fbd-4f22-a141-7b08787d6eab"}`. Collateral check: PostgREST via Kong (`GET /rest/v1/profiles?select=id` with the same real token) still returns exactly the caller's own row under RLS (`[{"id":"b353df4f-..."}]`, vs. `[]` with no token), and Storage (`GET /storage/v1/bucket`) still returns `200` rather than a `401`/`403` — both confirm HS256-only verification keeps working stack-wide, not just in FastAPI.

- [ ] **Step 4: Start the stack**

```bash
cd infra/supabase
sh run.sh start
cd ../..
```

Expected: `docker compose ps` (run from `infra/supabase`) shows all services (`db`, `auth`, `rest`, `realtime`, `storage`, `kong`, `studio`, and friends) in a healthy or running state within a couple of minutes.

- [ ] **Step 5: Verify Postgres and Studio are reachable**

Run: `psql "postgresql://postgres.your-tenant-id:$(grep ^POSTGRES_PASSWORD infra/supabase/.env | cut -d= -f2)@localhost:5432/postgres" -c "select 1;"`
Expected: returns `1`.

Note: host port 5432 in this stack version (self-hosted/v0.7.2) is bound to Supavisor (the `supabase-pooler` container), not directly to `supabase-db` — `docker compose ps` shows `supabase-db` with no host port mapping, only `supabase-pooler` publishing `0.0.0.0:5432->5432`. Supavisor requires a tenant-qualified username (`<user>.<tenant-id>`); a bare `postgres` user fails with `FATAL: (ENOIDENTIFIER) no tenant identifier provided`. `POOLER_TENANT_ID` in `infra/supabase/.env` defaults to the literal value `your-tenant-id` (confirmed in `infra/supabase/CONFIG.md`: "External tenant ID created at first startup" by the pooler provisioning script) — it is not a placeholder that needs replacing, so `postgres.your-tenant-id` is the correct username against a freshly generated `.env`. Any `DATABASE_URL` built from these values (root `.env` in Step 6 below, Task 3's migration `psql`, and Task 7/8/9's FastAPI/worker `DATABASE_URL`) must use the same tenant-qualified `postgres.your-tenant-id` username, not bare `postgres`, since they all connect through the same pooler on port 5432.

Open `http://localhost:8000` in a browser (or `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000`).
Expected: Kong responds (Studio login prompt in a browser, or a non-connection-refused HTTP status from curl — a `401` is expected and satisfies this check).

- [ ] **Step 6: Copy the generated values into the root `.env` for later tasks to read**

```bash
cp .env.example .env
```

Then manually edit `.env`, replacing the four `replace-with-generated-*` placeholders with the matching values from `infra/supabase/.env` (`POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY`), and update `DATABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to use the real password/anon key. `DATABASE_URL`'s username must be the tenant-qualified `postgres.your-tenant-id` (see Step 5 note above), not bare `postgres`.

- [ ] **Step 7: Commit the vendored stack (config only, `.env` stays gitignored)**

```bash
git add infra/supabase .gitignore
git commit -m "Vendor self-hosted Supabase Docker stack"
```

---

### Task 3: Database schema migration, RLS, and auto-provisioning trigger

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`

**Interfaces:**
- Consumes: the running Postgres from Task 2 (`DATABASE_URL` in root `.env`).
- Produces: every table listed in spec Section 4, RLS enabled and policied per the Global Constraints rule above, and a `profiles` row auto-created whenever a new `auth.users` row is inserted (i.e. whenever someone signs up).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0001_initial_schema.sql`:

```sql
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
```

- [ ] **Step 2: Apply the migration**

```bash
set -a; source .env; set +a
psql "$DATABASE_URL" -f supabase/migrations/0001_initial_schema.sql
```

Expected: completes with no errors, ending on the final `alter table jobs enable row level security;`.

- [ ] **Step 3: Verify table and RLS setup**

Run:
```bash
psql "$DATABASE_URL" -c "select count(*) from information_schema.tables where table_schema = 'public';"
psql "$DATABASE_URL" -c "select relname, relrowsecurity from pg_class where relname = 'projects';"
```
Expected: table count is 19, and `relrowsecurity` is `t` for `projects`.

- [ ] **Step 4: Verify the signup trigger creates a profile**

Run:
```bash
psql "$DATABASE_URL" -c "
insert into auth.users (id, email, encrypted_password, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111', 'phase0-test@example.com', 'x', '{\"full_name\": \"Phase 0 Test\"}');
"
psql "$DATABASE_URL" -c "select id, full_name from profiles where id = '11111111-1111-1111-1111-111111111111';"
```
Expected: the second query returns one row with `full_name` = `Phase 0 Test`.

- [ ] **Step 5: Clean up the test row**

```bash
psql "$DATABASE_URL" -c "delete from auth.users where id = '11111111-1111-1111-1111-111111111111';"
```
Expected: the cascading foreign key deletes the matching `profiles` row too (verify with a repeat of the select from Step 4, expect zero rows).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0001_initial_schema.sql
git commit -m "Add initial database schema, RLS policies, and signup trigger"
```

---

### Task 4: Next.js app skeleton

**Files:**
- Create: `apps/web/` (via `create-next-app`)
- Modify: `apps/web/app/layout.tsx`
- Modify: `apps/web/app/page.tsx`

**Interfaces:**
- Produces: a Next.js App Router project at `apps/web` with TypeScript, Tailwind, and shadcn/ui configured, that Task 5 and 6 build the auth flow into.

- [ ] **Step 1: Scaffold the Next.js app**

```bash
cd apps
npx create-next-app@latest web --typescript --tailwind --app --no-src-dir --import-alias "@/*" --eslint --use-npm --yes
cd ../..
```

- [ ] **Step 2: Initialize shadcn/ui**

```bash
cd apps/web
npx shadcn@latest init -d
npx shadcn@latest add button input label card
cd ../..
```

- [ ] **Step 3: Replace the default landing page with a minimal placeholder**

Edit `apps/web/app/page.tsx`:

```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <h1 className="text-2xl font-semibold">Agentic Second Brain</h1>
    </main>
  );
}
```

- [ ] **Step 4: Verify it builds and runs**

Run: `cd apps/web && npm run build`
Expected: build succeeds with no type errors.

Run: `npm run dev`, then in another terminal `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: `200`. Stop the dev server after verifying.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "Scaffold Next.js app with Tailwind and shadcn/ui"
```

---

### Task 5: Supabase SSR client helpers and session-refresh middleware

**Files:**
- Create: `apps/web/lib/supabase/client.ts`
- Create: `apps/web/lib/supabase/server.ts`
- Create: `apps/web/proxy.ts` (self-corrected from `middleware.ts` during implementation — see note below Step 5)
- Modify: `apps/web/.env.local` (gitignored, mirrors relevant values from root `.env`)

**Interfaces:**
- Produces: `createClient()` in `lib/supabase/client.ts` (browser Supabase client) and `createClient()` in `lib/supabase/server.ts` (async, cookie-aware server client for Server Components and Route Handlers) — both used by every page in Task 6 onward.

- [ ] **Step 1: Install the Supabase SSR package**

```bash
cd apps/web
npm install @supabase/supabase-js @supabase/ssr
cd ../..
```

- [ ] **Step 2: Write `apps/web/.env.local`**

```bash
NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
NEXT_PUBLIC_SUPABASE_ANON_KEY=<copy the ANON_KEY value from root .env>
NEXT_PUBLIC_API_URL=http://localhost:8001
```

Add `apps/web/.env.local` to `.gitignore` if `create-next-app` didn't already (it does by default, verify with `git check-ignore apps/web/.env.local`).

- [ ] **Step 3: Write the browser client**

Create `apps/web/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 4: Write the server client**

Create `apps/web/lib/supabase/server.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component, session refresh is
            // handled by middleware instead, safe to ignore here.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 5: Write the session-refresh middleware**

> **Self-corrected during implementation:** Next.js 16 deprecated the `middleware.ts` file convention and renamed it to `proxy.ts` (the exported function is renamed `middleware` → `proxy`); behavior is otherwise identical. See `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` and the official `npx @next/codemod@canary middleware-to-proxy .` codemod. The code below has been updated accordingly — create `apps/web/proxy.ts`, not `middleware.ts`.

Create `apps/web/proxy.ts`:

```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 6: Verify it compiles and the app still runs**

Run: `cd apps/web && npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib apps/web/proxy.ts apps/web/package.json apps/web/package-lock.json
git commit -m "Add Supabase SSR client helpers and session-refresh middleware"
```

---

### Task 6: Auth pages and protected app shell

**Files:**
- Create: `apps/web/app/(auth)/login/page.tsx`
- Create: `apps/web/app/(auth)/signup/page.tsx`
- Create: `apps/web/app/(auth)/auth/callback/route.ts`
- Create: `apps/web/app/(app)/layout.tsx`
- Create: `apps/web/app/(app)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `createClient()` from `apps/web/lib/supabase/server.ts` and `apps/web/lib/supabase/client.ts` (Task 5).
- Produces: a working signup/login/logout loop and a `(app)` route group that redirects to `/login` when there is no session.

- [ ] **Step 1: Write the signup page**

Create `apps/web/app/(auth)/signup/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h1 className="text-xl font-semibold">Create your account</h1>
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full">
          Sign up
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 2: Write the login page**

Create `apps/web/app/(auth)/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form onSubmit={handleSubmit} className="w-80 space-y-4">
        <h1 className="text-xl font-semibold">Log in</h1>
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        <Button type="submit" className="w-full">
          Log in
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 3: Write the OAuth/email-link callback route**

Create `apps/web/app/(auth)/auth/callback/route.ts`:

```ts
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
```

- [ ] **Step 4: Write the protected `(app)` layout**

Create `apps/web/app/(app)/layout.tsx`:

```tsx
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r p-4">
        <p className="text-sm font-medium">Second Brain</p>
      </aside>
      <div className="flex-1 p-6">{children}</div>
    </div>
  );
}
```

- [ ] **Step 5: Write the placeholder dashboard**

Create `apps/web/app/(app)/dashboard/page.tsx`:

```tsx
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <p>Signed in as {user?.email}</p>;
}
```

- [ ] **Step 6: Verify the full loop manually**

Run: `docker compose ps` (from `infra/supabase`, confirm the stack from Task 2 is still up), then `cd apps/web && npm run dev`.

1. Visit `http://localhost:3000/signup`, create an account with a real-looking email and a 6+ character password.
2. Expected: redirected to `/dashboard`, page shows "Signed in as <email>".
3. Run `psql "$DATABASE_URL" -c "select email from profiles p join auth.users u on u.id = p.id;"` (from repo root, with `.env` sourced).
   Expected: the row for the email just signed up appears, proving the Task 3 trigger fired for a real signup, not just the manual test insert.
4. Visit `http://localhost:3000/dashboard` in a fresh incognito window (no session).
   Expected: redirected to `/login`.

Stop the dev server after verifying.

**Self-correction (mechanical, not a design choice):** the first real signup attempt failed client-side with "Error sending confirmation email". `infra/supabase/.env` (from Task 2, inherited from the self-hosted Supabase `.env.example` template) sets `ENABLE_EMAIL_AUTOCONFIRM=false` with `SMTP_HOST=supabase-mail`, but this stack's `docker-compose.yml` defines no mail-catcher/SMTP service under that name — GoTrue has nowhere to send the confirmation email, so every signup fails at that step regardless of what Task 6's code does. Fixed by setting `ENABLE_EMAIL_AUTOCONFIRM=true` in `infra/supabase/.env` and `.env.example`, then `docker compose up -d auth` to pick up the change. This stack is local dev only (no real email delivery either way), so autoconfirm is the correct default; a deployment needing real email verification would need a real SMTP config and `ENABLE_EMAIL_AUTOCONFIRM=false`.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(auth)" "apps/web/app/(app)"
git commit -m "Add signup, login, callback route, and protected app shell"
```

---

### Task 7: FastAPI skeleton with a health endpoint

**Files:**
- Create: `apps/api/pyproject.toml`
- Create: `apps/api/main.py`
- Create: `apps/api/core/__init__.py`
- Create: `apps/api/core/config.py`
- Create: `apps/api/routers/__init__.py`
- Create: `apps/api/routers/health.py`
- Create: `apps/api/tests/__init__.py`
- Create: `apps/api/tests/test_health.py`

**Interfaces:**
- Produces: `get_settings() -> Settings` in `core/config.py` (reads env vars, used by Task 8's auth dependency), and a running FastAPI app mounted with `routers/health.py`'s router at `GET /health`.

- [ ] **Step 1: Register `apps/api` in the uv workspace and add its dependencies**

Add `"apps/api"` to the `members` list in the root `pyproject.toml`:

```toml
[tool.uv.workspace]
members = ["apps/api", "worker", "packages/ai_core"]
```

Create `apps/api/pyproject.toml`:

```toml
[project]
name = "second-brain-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic-settings>=2.6",
    "pyjwt>=2.9",
    "psycopg[binary]>=3.2",
    "ai-core",
]

[tool.uv.sources]
ai-core = { workspace = true }

[tool.uv]
package = false

[dependency-groups]
dev = ["pytest>=8.3", "httpx>=0.27", "cryptography>=43"]
```

- [ ] **Step 2: Write the settings module**

Create `apps/api/core/config.py`:

```python
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    jwt_secret: str


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

Create `apps/api/core/__init__.py` (empty file).

- [ ] **Step 3: Write the health router**

Create `apps/api/routers/health.py`:

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

Create `apps/api/routers/__init__.py` (empty file).

- [ ] **Step 4: Write the app entrypoint**

Create `apps/api/main.py`:

```python
from fastapi import FastAPI

from routers import health

app = FastAPI(title="Agentic Second Brain API")
app.include_router(health.router)
```

- [ ] **Step 5: Write the failing test**

Create `apps/api/tests/__init__.py` (empty file) and `apps/api/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 6: Install dependencies and run the test**

```bash
uv sync
cd apps/api && cp ../../.env .env && uv run --project . pytest tests/test_health.py -v && cd ../..
```

Expected: PASS (this endpoint has no dependency on `Settings`, so it passes even before `.env` values are meaningful).

- [ ] **Step 7: Verify the server actually runs**

```bash
cd apps/api
uv run --project . uvicorn main:app --port 8001 &
sleep 1
curl -s http://localhost:8001/health
kill %1
cd ../..
```

Expected: `{"status":"ok"}`.

- [ ] **Step 8: Commit**

```bash
git add pyproject.toml apps/api uv.lock
git commit -m "Scaffold FastAPI service with a health endpoint"
```

---

### Task 8: FastAPI JWT verification and a protected endpoint

**Files:**
- Create: `apps/api/core/auth.py`
- Create: `apps/api/routers/me.py`
- Create: `apps/api/tests/test_auth.py`
- Modify: `apps/api/main.py`

**Interfaces:**
- Consumes: `get_settings()` from `core/config.py` (Task 7).
- Produces: `verify_jwt(credentials: HTTPAuthorizationCredentials) -> str` in `core/auth.py`, a FastAPI dependency returning the authenticated user's id, used by `GET /me` here and by every AI/agent endpoint from Phase 1 onward.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/test_auth.py`:

```python
import time

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials

from core import auth as auth_module

TEST_SECRET = "test-jwt-secret-at-least-32-characters-long"
TEST_USER_ID = "11111111-1111-1111-1111-111111111111"


def _make_token(secret: str, sub: str, exp_delta: int = 3600, aud: str = "authenticated") -> str:
    payload = {"sub": sub, "aud": aud, "exp": int(time.time()) + exp_delta}
    return jwt.encode(payload, secret, algorithm="HS256")


def _credentials(token: str) -> HTTPAuthorizationCredentials:
    return HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)


def test_verify_jwt_returns_user_id_for_valid_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID)

    user_id = auth_module.verify_jwt(_credentials(token))

    assert user_id == TEST_USER_ID


def test_verify_jwt_rejects_expired_token(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID, exp_delta=-10)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401


def test_verify_jwt_rejects_wrong_secret(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token("a-completely-different-secret-value-here", sub=TEST_USER_ID)

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401


def test_verify_jwt_rejects_wrong_audience(monkeypatch):
    monkeypatch.setattr(auth_module, "_get_jwt_secret", lambda: TEST_SECRET)
    token = _make_token(TEST_SECRET, sub=TEST_USER_ID, aud="something-else")

    with pytest.raises(HTTPException) as exc_info:
        auth_module.verify_jwt(_credentials(token))

    assert exc_info.value.status_code == 401
```

Note: `cryptography` is imported for parity with future asymmetric tests but not strictly required for HS256, it is already a declared dev dependency from Task 7's `pyproject.toml`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd apps/api && uv run --project . pytest tests/test_auth.py -v && cd ../..
```
Expected: FAIL, `ModuleNotFoundError` or `AttributeError` on `core.auth`, since the module does not exist yet.

- [ ] **Step 3: Write the auth module**

Create `apps/api/core/auth.py`:

```python
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import get_settings

security = HTTPBearer()


def _get_jwt_secret() -> str:
    return get_settings().jwt_secret


def verify_jwt(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    token = credentials.credentials
    try:
        payload = jwt.decode(
            token,
            _get_jwt_secret(),
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc
    return payload["sub"]
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd apps/api && uv run --project . pytest tests/test_auth.py -v && cd ../..
```
Expected: 4 passed.

- [ ] **Step 5: Add the protected `/me` endpoint**

Create `apps/api/routers/me.py`:

```python
from fastapi import APIRouter, Depends

from core.auth import verify_jwt

router = APIRouter()


@router.get("/me")
def me(user_id: str = Depends(verify_jwt)) -> dict[str, str]:
    return {"user_id": user_id}
```

Modify `apps/api/main.py`:

```python
from fastapi import FastAPI

from routers import health, me

app = FastAPI(title="Agentic Second Brain API")
app.include_router(health.router)
app.include_router(me.router)
```

- [ ] **Step 6: Verify `/me` end to end against a real token**

With the Task 2 Supabase stack and `apps/web` dev server running, sign in at `http://localhost:3000/login` with the account created in Task 6, then in the browser console run `(await (await fetch('/api/auth/session')).json())` is not applicable here (no such route exists), instead read the `sb-access-token` value directly:

```bash
cd apps/api
uv run --project . uvicorn main:app --port 8001 &
sleep 1
# Paste a real access token copied from the browser's Application > Cookies
# (the cookie named like sb-<project-ref>-auth-token, base64-decoded JSON
# has an access_token field) as TOKEN below.
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8001/me
kill %1
cd ../..
```

Expected: `{"user_id":"<the signed-in user's uuid>"}`, matching the `id` column of that user's row in `profiles`.

**Self-correction found here, fixed under Task 2 (2026-08-09):** the first real end-to-end attempt against this stack failed — a real GoTrue-issued token decoded to `{"alg": "ES256", ...}`, not `HS256`, so `verify_jwt` (built exactly per this task's Step 3, unchanged) correctly rejected it with `401`. Root cause was an infra-config drift from Task 2's key-generation script, not a bug in this task's code. Full root cause, fix, and re-verification (including the PostgREST/Storage collateral check) are documented under Task 2's Step 3, since that's where the vendor script that caused the drift is invoked. After the fix, a fresh real token decodes to `HS256` and `GET /me` returns `200 {"user_id":"b353df4f-8fbd-4f22-a141-7b08787d6eab"}` as expected above.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "Add JWT verification dependency and protected /me endpoint"
```

---

### Task 9: Worker skeleton with a Postgres-backed job queue

**Files:**
- Modify: `worker/main.py`
- Create: `worker/tests/__init__.py`
- Create: `worker/tests/test_jobs.py`

**Interfaces:**
- Produces: `claim_next_job(conn) -> dict | None` and `mark_done(conn, job_id) -> None` in `worker/main.py`, the shape every real job handler registered in Phase 1+ builds on.

- [ ] **Step 1: Write the failing integration test**

This test requires the Task 2 Supabase stack and the Task 3 migration to be applied, since it exercises the real `jobs`, `profiles`, and `auth.users` tables together.

Create `worker/tests/__init__.py` (empty file) and `worker/tests/test_jobs.py`:

```python
import os
import uuid

import psycopg
import pytest

from main import claim_next_job, mark_done

DATABASE_URL = os.environ["DATABASE_URL"]
TEST_USER_ID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def conn():
    with psycopg.connect(DATABASE_URL, autocommit=False) as connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                insert into auth.users (id, email, encrypted_password)
                values (%s, 'phase0-worker-test@example.com', 'x')
                on conflict (id) do nothing
                """,
                (TEST_USER_ID,),
            )
        connection.commit()
        yield connection
        with connection.cursor() as cur:
            cur.execute("delete from auth.users where id = %s", (TEST_USER_ID,))
        connection.commit()


def test_claim_next_job_returns_queued_job_and_marks_it_running(conn):
    job_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into jobs (id, user_id, job_type, payload, status)
            values (%s, %s, 'smoke_test', '{}', 'queued')
            """,
            (job_id, TEST_USER_ID),
        )
    conn.commit()

    job = claim_next_job(conn)

    assert job is not None
    assert job["id"] == job_id
    assert job["job_type"] == "smoke_test"

    with conn.cursor() as cur:
        cur.execute("select status, attempts from jobs where id = %s", (job_id,))
        status, attempts = cur.fetchone()
    assert status == "running"
    assert attempts == 1


def test_claim_next_job_returns_none_when_queue_is_empty(conn):
    with conn.cursor() as cur:
        cur.execute("delete from jobs where user_id = %s", (TEST_USER_ID,))
    conn.commit()

    job = claim_next_job(conn)

    assert job is None


def test_mark_done_sets_status_done(conn):
    job_id = uuid.uuid4()
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into jobs (id, user_id, job_type, payload, status)
            values (%s, %s, 'smoke_test', '{}', 'running')
            """,
            (job_id, TEST_USER_ID),
        )
    conn.commit()

    mark_done(conn, job_id)

    with conn.cursor() as cur:
        cur.execute("select status from jobs where id = %s", (job_id,))
        (status,) = cur.fetchone()
    assert status == "done"
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd worker && uv run --project . pytest tests/test_jobs.py -v && cd ..
```
Expected: FAIL, `ImportError: cannot import name 'claim_next_job' from 'main'`.

- [ ] **Step 3: Write the real worker module**

Replace `worker/main.py`:

```python
import os
import time
import uuid

import psycopg

DATABASE_URL = os.environ["DATABASE_URL"]
POLL_INTERVAL_SECONDS = float(os.environ.get("WORKER_POLL_INTERVAL_SECONDS", "2"))


def claim_next_job(conn: psycopg.Connection) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(
            """
            select id, user_id, job_type, payload
            from jobs
            where status = 'queued' and run_at <= now()
            order by run_at
            for update skip locked
            limit 1
            """
        )
        row = cur.fetchone()
        if row is None:
            conn.commit()
            return None
        job_id, user_id, job_type, payload = row
        cur.execute(
            "update jobs set status = 'running', attempts = attempts + 1 where id = %s",
            (job_id,),
        )
    conn.commit()
    return {"id": job_id, "user_id": user_id, "job_type": job_type, "payload": payload}


def handle_job(job: dict) -> None:
    # Phase 1+ registers real handlers per job_type (process_capture,
    # run_scheduler, missed_task_pass, daily_review, weekly_review).
    # Until then, any job type is logged and considered handled, which
    # is enough to prove the claim/mark_done loop works end to end.
    print(f"worker: handled job {job['id']} ({job['job_type']})")


def mark_done(conn: psycopg.Connection, job_id: uuid.UUID) -> None:
    with conn.cursor() as cur:
        cur.execute("update jobs set status = 'done' where id = %s", (job_id,))
    conn.commit()


def run_forever() -> None:
    with psycopg.connect(DATABASE_URL) as conn:
        print("worker: started, polling for jobs")
        while True:
            job = claim_next_job(conn)
            if job is None:
                time.sleep(POLL_INTERVAL_SECONDS)
                continue
            handle_job(job)
            mark_done(conn, job["id"])


if __name__ == "__main__":
    run_forever()
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
set -a; source .env; set +a
cd worker && uv run --project . pytest tests/test_jobs.py -v && cd ..
```
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add worker
git commit -m "Implement worker job-claiming loop over the Postgres-backed queue"
```

---

### Task 10: Docker Compose wiring and full-stack smoke test

**Files:**
- Create: `apps/web/Dockerfile`
- Create: `apps/api/Dockerfile`
- Create: `worker/Dockerfile`
- Create: `infra/docker-compose.yml`
- Create: `infra/Caddyfile`
- Modify: `apps/web/next.config.ts` (enable standalone output)

**Interfaces:**
- Produces: a single `docker compose -f infra/docker-compose.yml up` that brings up `web`, `api`, `worker`, and includes the Task 2 Supabase stack, all reachable through Caddy.

- [ ] **Step 1: Enable Next.js standalone output**

Edit `apps/web/next.config.ts`:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default nextConfig;
```

- [ ] **Step 2: Write the web Dockerfile**

Create `apps/web/Dockerfile`:

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 3: Write the API Dockerfile**

Create `apps/api/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
COPY apps/api ./apps/api
COPY worker ./worker
COPY packages/ai_core ./packages/ai_core
RUN uv sync --project apps/api --no-dev
EXPOSE 8001
CMD ["uv", "run", "--project", "apps/api", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001", "--app-dir", "apps/api"]
```

Note: the `worker` directory is copied in even though the API image never runs it, this is required because the root `pyproject.toml` declares a single `uv` workspace across `apps/api`, `worker`, and `packages/ai_core`, and `uv sync` resolves against the whole workspace's `uv.lock`, it fails if any declared member's `pyproject.toml` is missing from the build context, not just the one being installed.

- [ ] **Step 4: Write the worker Dockerfile**

Create `worker/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir uv
COPY pyproject.toml uv.lock ./
COPY worker ./worker
COPY apps/api ./apps/api
COPY packages/ai_core ./packages/ai_core
RUN uv sync --project worker --no-dev
CMD ["uv", "run", "--project", "worker", "--", "python", "worker/main.py"]
```

Same reasoning as Step 3: all three workspace members must be present in the build context for `uv sync` to resolve, even though this image only runs `worker/main.py`.

- [ ] **Step 5: Write the Caddyfile**

Create `infra/Caddyfile`:

```
:80 {
  handle /api/* {
    uri strip_prefix /api
    reverse_proxy api:8001
  }
  handle {
    reverse_proxy web:3000
  }
}
```

- [ ] **Step 6: Write the top-level Compose file**

Create `infra/docker-compose.yml`:

```yaml
include:
  - path: ./supabase/docker-compose.yml

services:
  web:
    build:
      context: ../apps/web
    environment:
      NEXT_PUBLIC_SUPABASE_URL: ${NEXT_PUBLIC_SUPABASE_URL}
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ${NEXT_PUBLIC_SUPABASE_ANON_KEY}
      NEXT_PUBLIC_API_URL: ${NEXT_PUBLIC_API_URL}
    ports:
      - "3000:3000"

  api:
    build:
      context: ../
      dockerfile: apps/api/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
    ports:
      - "8001:8001"
    depends_on:
      - db

  worker:
    build:
      context: ../
      dockerfile: worker/Dockerfile
    environment:
      DATABASE_URL: ${DATABASE_URL}
    depends_on:
      - db

  caddy:
    image: caddy:2
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
    ports:
      - "80:80"
    depends_on:
      - web
      - api
```

- [ ] **Step 7: Bring up the full stack**

```bash
cd infra/supabase && sh run.sh stop && cd ../..
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
```

- [ ] **Step 8: Verify every service is reachable**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/           # web via Caddy
curl -s http://localhost/api/health                                   # api via Caddy
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000        # Supabase Kong, direct
```
Expected: `200`, `{"status":"ok"}`, and a non-connection-refused status, respectively.

- [ ] **Step 9: Verify the worker is polling against the containerized Postgres**

```bash
docker compose -f infra/docker-compose.yml logs worker --tail 5
```
Expected: `worker: started, polling for jobs` present in the log output.

- [ ] **Step 10: Verify end-to-end auth through the containerized stack**

Visit `http://localhost/signup`, create a second test account, confirm redirect to `/dashboard` shows the signed-in email, exactly as in Task 6 Step 6, this time against the fully containerized stack rather than local dev servers.

- [ ] **Step 11: Tear down**

```bash
docker compose -f infra/docker-compose.yml down
```

- [ ] **Step 12: Commit**

```bash
git add infra apps/web/Dockerfile apps/web/next.config.ts apps/api/Dockerfile worker/Dockerfile
git commit -m "Wire web, api, and worker into Docker Compose behind Caddy"
```

---

## Definition of Done

- [ ] `docker compose -f infra/docker-compose.yml --env-file .env up -d --build` brings up the entire stack with no manual intervention beyond secrets already being generated (Task 2).
- [ ] A new user can sign up at `/signup`, land on `/dashboard`, and a matching `profiles` row exists.
- [ ] `GET /api/health` returns `{"status":"ok"}` through Caddy.
- [ ] A valid Supabase-issued access token, sent as a bearer token to `GET /api/me`, returns that user's id, an invalid or expired one returns 401.
- [ ] The worker log shows it polling, and `worker/tests/test_jobs.py` passes against the real database.
- [ ] All of `apps/api/tests/` and `worker/tests/` pass via `uv run pytest` from each project directory.
