# Agentic Second Brain, Product & Architecture Blueprint

Status: approved design, ready for implementation planning
Date: 2026-08-07
Scope: full blueprint (PRD through deployment strategy). Code implementation is a separate follow-on effort, planned once this spec is approved.

## 0. Product Vision & Philosophy

Agentic Second Brain is an agentic personal knowledge and workflow system. It is not a note-taking app with an AI feature bolted on, it is an intelligent agent layer that captures information, understands context, remembers everything important, connects related knowledge, plans work, and proactively helps the user reach long-term goals.

It combines what Obsidian does for knowledge, what Notion does for organization, what Todoist does for tasks, what Cursor does for context awareness, and what a good executive assistant does for judgment, into one continuously running loop:

Capture, Understand, Connect, Plan, Act, Learn.

The system proactively organizes notes, creates tasks, detects projects, identifies deadlines, summarizes meetings, generates plans, suggests next actions, reviews progress, reschedules work, and answers questions using the user's own accumulated knowledge.

**Target users:** university students, software engineers, founders, researchers, and professionals managing multiple concurrent projects. All five share one trait this product is built around: they generate more information and commitments than they can manually organize, and the cost of a dropped thread (a missed deadline, a forgotten decision, a task that silently never got scheduled) is high.

**Success looks like:** a user captures something in under 5 seconds without deciding where it goes, and a week later the system can answer "what did I decide about X and why" correctly, has already turned their stated goals into scheduled tasks, and tells them what's actually at risk before they find out the hard way.

---

## 1. Product Requirements Document (PRD)

### 1.1 Problem statement
Knowledge workers today split their tools: notes in one app, tasks in another, calendar in a third, and no system connects what they know to what they need to do. Each capture requires manual filing (which project, is this a task, who's mentioned, when's it due), so most captured information is filed nowhere and decays into an unsearchable pile. Existing AI features are chat-on-the-side, they answer questions if asked but don't proactively act on what they know.

### 1.2 Goals
1. Reduce the cost of capturing anything to near zero (one action, any format).
2. Make organization a system responsibility, not a user chore.
3. Turn captured knowledge into scheduled, trackable action automatically.
4. Make the system able to answer questions about the user's own history and reasoning.
5. Proactively surface risk (missed deadlines, stalled projects, forgotten commitments) before the user asks.

### 1.3 Non-goals (explicitly out of scope for this product)
- Real-time multiplayer document editing (this is a personal system, not a team wiki, team workspaces are a possible v3 direction, not this blueprint).
- Being a general-purpose chatbot unrelated to the user's own knowledge and work.
- Replacing a full project management suite for large teams (Jira-scale ticketing, sprints, burndown charts).

### 1.4 Success metrics
- Percent of captures that reach `status: organized` without manual correction.
- Median time from capture to the first useful AI output (summary, task, or link) appearing.
- Weekly review adoption (percent of active users who read at least one generated review per week).
- Task completion rate for AI-scheduled tasks versus manually scheduled ones.
- Recall accuracy of the Memory Agent, sampled against user-marked "that answer was right or wrong" feedback.

### 1.5 Personas
- **Student (Sokha):** juggles coursework, thesis research, and job applications. Needs sources connected to arguments, deadlines that don't slip, and a way to ask "what have I already read about X."
- **Engineer (Vandara):** captures decisions from PRs, design docs, and standups. Needs "why did we choose Redis" answered correctly six months later, and tasks that respect actual focus time.
- **Founder (Dara):** juggles five workstreams at once. Needs a weekly review that tells the truth about what didn't move, and a Planner that turns "launch MyLMS" into a real plan without a full afternoon of manual breakdown.

---

## 2. Feature Specification

### 2.1 Dashboard
Today's focus (tasks scheduled into today's time blocks), active projects with progress bars, overdue tasks, recent captures with live processing status, an AI insights panel (latest unread Workflow/Review agent output), one suggested next action with a one-click accept, and knowledge reminders (content resurfaced by relevance, not just recency).

### 2.2 Inbox
Quick capture via text, voice (recorded in-browser or uploaded), image, PDF, URL, or pasted meeting notes. Every item shows live pipeline status (`pending`, `processing`, `organized`, `needs review`). Items the pipeline is not confident about (ambiguous project match, no clear action) land in a "needs review" filter instead of being silently misfiled.

### 2.3 AI Processing Pipeline
Runs automatically on every capture: summarize, extract entities, identify project, detect people, detect deadlines, detect action items, detect decisions, generate tags, create task if needed, create embeddings, link related notes. Fully detailed in Section 12.

### 2.4 Notes
Markdown and richtext editing, `[[backlinks]]` resolved into the `relationships` graph, inline references to tasks/projects/people, attachments, an AI-generated summary shown collapsed above long notes, a "related knowledge" panel (vector-similarity driven), and a timeline view per note showing its edit and linkage history.

### 2.5 Knowledge Graph
Auto-evolving graph over projects, people, concepts, documents, meetings, tasks, and decisions. Detailed in Section 14.

### 2.6 Projects
Overview, goals, timeline, tasks, notes, documents, decisions log, an AI-generated summary that refreshes when enough new linked content accumulates, a progress percentage (derived from task completion, not manually set), a risks list (AI-flagged, dismissible), and dependencies on other projects.

### 2.7 Tasks
Priority, energy level, estimated duration, deadline, dependencies, a free-text context field, and project linkage. The Planner Agent can break a large goal into a subtask tree (see example in Section 15). Board, list, and "today" views.

### 2.8 Calendar Intelligence
Internal calendar (MVP) that the scheduling algorithm owns directly, Google Calendar two-way sync deferred to v2 (Section 17). Missed tasks are automatically rescheduled, with cascading dependency and project timeline updates. Detailed in Section 15.

### 2.9 Agentic Features
Six agents: Memory, Planner, Research, Writer, Review, Workflow. Detailed in Section 6.

### 2.10 AI Workspace
A full-context chat interface, streaming responses, able to answer "what am I forgetting," "summarize everything about Project X," "create a presentation from my notes," and "generate interview answers from my experiences." Each response can cite which notes/projects it drew from.

### 2.11 Daily Review
Generated each night: completed tasks, unfinished tasks, new knowledge captured, important decisions made, blockers, and tomorrow's priorities.

### 2.12 Weekly Review
Generated each week: project progress, knowledge learned, time allocation (derived from completed `time_blocks`), missed deadlines, and strategic recommendations.

### 2.13 Settings
Profile, subscription/billing, working-hours and energy-profile preferences (feeds the scheduler), notification preferences, connected integrations, data export, and account deletion.

---

## 3. User Flows

### 3.1 Onboarding
1. Sign up (email/password or OAuth via Supabase Auth).
2. Short preference setup: working hours, energy profile (when are you sharpest), primary goal (student, engineer, founder, researcher, other), and current active projects (optional, can be skipped and detected later from captures).
3. Land on an empty Dashboard with a single prompt: "Capture your first thing, anything on your mind."
4. First capture runs through the pipeline live, with the UI narrating each step the first time only ("reading it... found a deadline... creating a task"), to teach the mental model once, not every time.

### 3.2 Capture to organized
1. User captures (any format) from Inbox or the global command palette's quick-capture.
2. Item written to `captures`, `status: pending`, immediately visible in Inbox.
3. Worker picks up the queued job, runs the pipeline (Section 12).
4. Realtime pushes each status change to the UI, the item settles at `organized` (or `needs review` if confidence is low on project/task decisions).
5. If a task or project link was created, it appears in Tasks/Projects immediately, with a link back to the source capture.

### 3.3 Task creation and scheduling
1. Task created (directly by the user, or by the pipeline/Planner Agent).
2. On the next scheduling run (triggered on creation, and on an hourly cadence for the missed-task pass), the algorithm places it into a time block if the candidate set includes it (Section 15).
3. If it cannot be placed before its deadline, it's flagged `at_risk` and surfaces on the Dashboard and the parent project's risks list.
4. If a scheduled task is missed, the missed-task pass releases its time block, re-queues it, and cascades any dependent task's earliest start forward.

### 3.4 Weekly review
1. Sunday night (configurable), the worker triggers the Review Agent's weekly graph.
2. It gathers the week's completed/incomplete tasks, new notes and captures, decisions logged, and time-block adherence.
3. Produces a `weekly_reviews` row, surfaced on Dashboard and in Reviews, with a notification.
4. User can ask AI Workspace follow-up questions against that specific review's context.

### 3.5 AI Workspace query
1. User opens Workspace, types or is mid-conversation.
2. Next.js calls FastAPI's streaming chat endpoint with the query and conversation id.
3. Context builder retrieves relevant notes/tasks/projects/entities via vector search and graph traversal.
4. The relevant agent graph (usually Memory, sometimes it hands off to Planner or Writer based on intent classification) runs, streams tokens back over SSE.
5. Response renders with inline citations back to source notes, clicking one opens that note.

---

## 4. Database Schema

Postgres via self-hosted Supabase, `pgvector` extension enabled. All tenant-owned tables carry `user_id` and RLS. Timestamps are `timestamptz`, all primary keys are `uuid default gen_random_uuid()`.

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
```

**RLS pattern** (applied to every tenant-owned table, shown once, repeats identically):

```sql
alter table projects enable row level security;

create policy "select own rows" on projects
  for select using (auth.uid() = user_id);
create policy "insert own rows" on projects
  for insert with check (auth.uid() = user_id);
create policy "update own rows" on projects
  for update using (auth.uid() = user_id);
create policy "delete own rows" on projects
  for delete using (auth.uid() = user_id);
```

The `jobs` table is the one exception: it's written by triggers and read only by the worker's service-role connection, so it has RLS enabled with no user-facing policies at all (deny by default), only the service role bypasses it.

---

## 5. API Architecture

Two API surfaces, on purpose (Section on service split, already approved): Next.js talks to Supabase directly for CRUD, FastAPI is the AI service.

### 5.1 Next.js server-side routes (minimal, only what must run server-side)
| Route | Purpose |
|---|---|
| `GET /auth/callback` | Supabase OAuth/email-link callback, exchanges code for session |
| `POST /api/capture/upload-url` | Requests a signed Supabase Storage upload URL for voice/image/PDF (kept server-side to apply size/type limits before issuing the URL) |

Everything else, listing notes, updating a task, dragging a task on the board, reading a project, is a direct Supabase client SDK call from the React components, protected by RLS. This is a deliberate choice, it means most of the app has no custom backend code to maintain at all.

### 5.2 FastAPI endpoints
| Method & path | Purpose |
|---|---|
| `POST /captures/{id}/reprocess` | Manually re-run the pipeline on a capture (user-triggered correction) |
| `GET /search?q=&mode=hybrid` | Hybrid full-text plus vector search across the user's content |
| `POST /agents/memory/query` | One-shot question answering, non-streaming (used by API integrations, v2) |
| `POST /agents/memory/stream` | SSE streaming chat, Memory Agent (default AI Workspace entry point) |
| `POST /agents/planner/plan` | Decompose a goal/project into a task tree and proposed schedule |
| `POST /agents/writer/draft` | Draft a document (email, report, presentation outline) from context |
| `POST /agents/review/daily` | Trigger (or re-trigger) today's daily review |
| `POST /agents/review/weekly` | Trigger (or re-trigger) this week's weekly review |
| `POST /agents/workflow/check` | Run project monitoring, returns proposed `agent_actions` |
| `POST /schedule/run` | Invoke the scheduling algorithm for the current user |
| `POST /webhooks/stripe` | Stripe webhook receiver, updates `subscriptions` |
| `GET /health` | Liveness/readiness probe |

Every non-webhook, non-health endpoint requires `Authorization: Bearer <supabase JWT>`. Request/response bodies are Pydantic models, shared between FastAPI and the worker via the `ai_core` package so there's one schema definition, not two.

---

## 6. Agent Architecture

All 6 agents are LangGraph graphs sharing one context-builder step. See the approved design from Section 3 of the brainstorming conversation, restated here for completeness:

| Agent | Graph shape | Reads | Writes |
|---|---|---|---|
| Memory | retrieve then answer | vector search, graph traversal | none |
| Planner | decompose, sequence, estimate, schedule | projects, tasks, calendar | tasks, task_dependencies, time_blocks |
| Research | fetch, chunk, compare, synthesize | documents, web fetch (v2) | notes (summary type) |
| Writer | outline, draft, refine | notes, projects | draft notes only |
| Review | gather, summarize, flag | full period read | daily_reviews, weekly_reviews |
| Workflow | monitor, diagnose, propose | projects, tasks | proposals only, confirmed before writing |

**Context builder:** given a query or trigger, runs a pgvector similarity search over `embeddings` (top-k, k configurable per agent, Memory uses a wider k than Writer), a depth-2 traversal of `relationships` from whatever matched, and pulls the last N relevant `agent_actions` for continuity. Output is a bounded, ranked context object passed into whichever graph runs next.

**The one hard rule across all agents:** read and suggest freely, write only what's unambiguous (a generated tag, an embedding) or explicitly confirmed by the user (a reschedule, a project status change). Every write is logged to `agent_actions` with enough detail to undo it.

---

## 7. Vector Search Architecture

**Embedding model:** Gemini's embedding model (`text-embedding-004` or current equivalent), 768 dimensions, chosen to keep the entire AI surface on one vendor for the free tier.

**Chunking:** content is split into roughly 500-token chunks with 50-token overlap before embedding. Short content (most tasks, short notes) is a single chunk. Long notes, documents, and meeting transcripts are split, each chunk gets its own `embeddings` row referencing the same `content_id`, so a semantic match can point back to the specific passage, not just the parent note.

**Index:** `hnsw` index on `embeddings.embedding` with `vector_cosine_ops`, chosen over `ivfflat` because HNSW gives better recall at query time without needing a periodic rebuild as data grows, and this workload is read-heavy relative to writes.

**Query pattern (hybrid search):**
```sql
-- vector leg
select content_type, content_id, chunk_text,
       1 - (embedding <=> :query_embedding) as similarity
from embeddings
where user_id = :user_id
order by embedding <=> :query_embedding
limit 20;

-- full text leg (pg_trgm / tsvector on notes.title + content, tasks.title, etc.)
-- results from both legs are combined client-side (FastAPI) via
-- reciprocal rank fusion, so an exact keyword hit and a semantic
-- match both surface, neither dominates unconditionally.
```

**Write path:** the pipeline's `create_embeddings` node and any agent that creates new content (Writer, Planner) are the only writers. Re-embedding happens on content update (a note edit re-chunks and re-embeds only if the diff is substantial, to avoid needless API calls on trivial edits).

---

## 8. Folder Structure

Monorepo, one deployable unit set, one CI pipeline.

```
agentic-second-brain/
  apps/
    web/                      # Next.js app
      app/
        (auth)/
          login/
          signup/
          auth/callback/route.ts
        (app)/
          dashboard/
          inbox/
          notes/[id]/
          projects/[id]/
          tasks/
          calendar/
          graph/
          workspace/
          reviews/
          settings/
          layout.tsx           # app shell: sidebar, command palette
        layout.tsx
        globals.css
      components/
        ui/                    # shadcn components
        capture/ notes/ tasks/ projects/ calendar/ graph/ workspace/ reviews/
        command-palette/
      lib/
        supabase/client.ts
        supabase/server.ts
        api/                   # typed fetch wrappers for FastAPI endpoints
        hooks/ utils/
      types/
      package.json
      Dockerfile
    api/                       # FastAPI app
      main.py
      core/
        config.py
        auth.py                 # JWT verification dependency
        supabase.py             # per-request Supabase client scoped by user JWT
      routers/
        captures.py agents.py schedule.py search.py webhooks.py
      pyproject.toml
      Dockerfile
  packages/
    ai_core/                   # shared Python package, imported by api and worker
      pipeline/
        graph.py
        nodes/
          summarize.py extract_entities.py identify_project.py
          detect_people.py detect_deadlines.py detect_decisions.py
          detect_action_items.py create_task_if_needed.py
          generate_tags.py create_embeddings.py link_related_notes.py
      agents/
        memory/ planner/ research/ writer/ review/ workflow/
        context_builder.py
      llm/
        gemini_client.py
      scheduling/
        algorithm.py
      models/                  # pydantic schemas shared across api and worker
      pyproject.toml
  worker/
    main.py                    # polling loop, imports ai_core
    Dockerfile
  supabase/
    migrations/
    seed.sql
  infra/
    docker-compose.yml
    Caddyfile
    github-actions/
  docs/
    superpowers/specs/
  .env.example
  README.md
```

---

## 9. Next.js Implementation Plan (high level)

The App Router splits into an `(auth)` group (login, signup, callback, no shell) and an `(app)` group (everything behind auth, shares one layout with sidebar navigation and the command palette). Each of the 10 sections is its own route segment with its own `page.tsx`, `loading.tsx`, and colocated components where a component is truly section-specific, shared ones live in top-level `components/`.

Data fetching for CRUD-heavy views (Notes, Tasks, Projects) uses Supabase's client SDK in Server Components for the initial load, then client-side subscriptions (Supabase Realtime) for live updates, so a task moving on the board or a capture finishing processing shows up without a manual refresh. AI Workspace and any agent-triggered actions go through the typed `lib/api/` wrappers that call FastAPI.

State that's genuinely global (current user, command palette open state, theme) lives in a small root-level context, everything else stays local to its route or is server state via Supabase subscriptions, deliberately avoiding a heavier global state library the app doesn't need.

The detailed component-by-component build plan is out of scope for this blueprint, it belongs in the implementation plan produced by the writing-plans skill once this spec is approved.

---

## 10. Supabase Schema

Covered in full in Section 4 (Database Schema), this section adds the Supabase-specific pieces:

- **Auth:** Supabase Auth (GoTrue) handles signup/login (email+password and OAuth providers), issues JWTs. A `handle_new_user` trigger on `auth.users` inserts the matching `profiles` row automatically on signup.
- **Storage buckets:** `captures` (voice/image/PDF originals, private, RLS via Storage policies keyed to `auth.uid()` matching the path prefix), `documents` (uploaded reference documents, same pattern).
- **Realtime:** enabled on `captures`, `tasks`, `time_blocks`, `agent_actions`, so the UI can subscribe to exactly the tables that change from background processes (worker, agents) without polling.
- **Migrations:** managed via the Supabase CLI (`supabase/migrations/`), applied as part of the deploy pipeline (Section 18), never hand-run against production.

---

## 11. Authentication Flow

1. User signs up or logs in via Supabase Auth (Next.js, using `@supabase/ssr` for cookie-based session handling).
2. Supabase issues an access token (JWT, short-lived) and refresh token, stored in httpOnly cookies by the SSR helper.
3. Next.js Server Components read the session from cookies for server-rendered pages, Client Components use the Supabase client which auto-refreshes the token.
4. Direct Supabase calls (CRUD) authenticate as the user automatically via the SDK, RLS does the enforcement, no custom backend check needed.
5. When Next.js calls FastAPI, it attaches the current access token as `Authorization: Bearer <token>`.
6. FastAPI's auth dependency verifies the JWT against Supabase's JWKS endpoint (not a shared secret, so key rotation on Supabase's side doesn't require a redeploy), extracts `sub` (the user id), and constructs a Postgres connection for that request using the same JWT, so RLS applies inside FastAPI too, not just in Next.js. This is the defense-in-depth point from Section 1: isolation is enforced at the database layer regardless of which service is asking.
7. The worker, which has no per-request user session (it processes jobs for many users), uses the Supabase service role key, but every query it runs explicitly filters by the `user_id` on the job it's processing, service role bypasses RLS, so this filtering is a required discipline, not optional, and is covered by tests.

---

## 12. AI Processing Pipeline

Restating and finalizing the LangGraph design from the brainstorming conversation:

```
capture -> summarize -> extract_entities -+-> detect_people -----+
                                            +-> detect_deadlines --+
                                            +-> detect_decisions --+
                                                                    v
                              identify_project <-- (uses entities) +
                                     |                              |
                                     v                              v
                          detect_action_items --> create_task_if_needed
                                     |
                                     v
                          generate_tags --> create_embeddings --> link_related_notes --> done
```

Each node is a pure-ish function: `(PipelineState) -> PipelineState`, independently unit-testable with a fixed input capture and an asserted output delta. Node responsibilities:

1. **summarize:** 2-3 sentence summary of the raw capture, written to `notes.ai_summary` once the note exists (or held in state until then).
2. **extract_entities:** named entities (people, concepts, organizations), upserted into `entities`.
3. **identify_project:** matches against existing projects via a combination of explicit mention and embedding similarity to project overviews, only auto-assigns above a confidence threshold, otherwise leaves `project_id` null and flags `needs_review`.
4. **detect_people:** cross-references extracted entities of kind `person` against known entities, links via `relationships` (`mentions`).
5. **detect_deadlines:** parses explicit and relative dates ("by Friday", "next sprint") into concrete timestamps.
6. **detect_decisions:** flags sentences with decision language ("we chose", "decided to", "going with"), creates a `note_type: decision` note if a decision is found in a capture that doesn't already have one.
7. **detect_action_items:** identifies actionable statements distinct from general content.
8. **create_task_if_needed:** only fires if `detect_action_items` found something concrete and time-bound enough to act on, creates a `tasks` row with best-guess priority/energy/duration, always linked back to `capture_id`.
9. **generate_tags:** short, reused-when-possible tags (checks existing `tags` for the user before minting new ones).
10. **create_embeddings:** chunks and embeds the resulting note/task/document content.
11. **link_related_notes:** vector search against the user's existing embeddings, creates `relationships` rows (`relates_to`) above a similarity threshold, capped at a small number of strongest links to keep the graph meaningful rather than dense.

Every node's output, including "decided not to act" (no task created, no project matched), is logged to `agent_actions` with `agent_name: pipeline`, so a user auditing "why didn't this become a task" has an answer.

---

## 13. Dashboard Wireframe

```
+------------------------------------------------------------------------+
|  [Logo] Second Brain        [Cmd+K  Search...]           [Avatar v]    |
+-----------+--------------------------------------------------------------+
| Dashboard | Good morning.  Tuesday, Aug 7                                |
| Inbox (3) | +--------------------------+  +---------------------------+ |
| Notes     | | Today's Focus            |  | Suggested Next Action     | |
| Projects  | | [ ] Finish MyLMS wires   |  | "Draft the investor        | |
| Tasks     | | [ ] Call w/ Sokha 2pm    |  |  update, Monday's call      | |
| Calendar  | | [ ] Review PR #142       |  |  notes cover most of it." | |
| Graph     | +--------------------------+  |  [Draft it]  [Dismiss]    | |
| Workspace | +--------------------------+  +---------------------------+ |
| Reviews   | | Active Projects (4)      |  +---------------------------+ |
| Settings  | | MyLMS        [######  ] 72%  | Overdue (2)                | |
|           | | Thesis Ch.3  [###     ] 40%  | ! Submit grant draft       | |
|           | | Job Search   [#       ] 15%  | ! Reply to Prof. Lin       | |
|           | +--------------------------+  +---------------------------+ |
|           | +--------------------------+  +---------------------------+ |
|           | | Recent Captures           |  | Knowledge Reminder         | |
|           | | (mic) Voice memo, 8:03am |  | "You looked at this 3      | |
|           | | (doc) redis-vs-pg.pdf    |  |  weeks ago: Why Redis,     | |
|           | | (link) raycast.com/blog |  |  might be relevant again." | |
|           | +--------------------------+  +---------------------------+ |
+-----------+--------------------------------------------------------------+
```

Every panel queries existing tables, the Dashboard owns no new data of its own, which is what keeps it cheap to build and impossible to get out of sync with the rest of the app.

---

## 14. Knowledge Graph Design

Node types map directly to object tables: `projects`, `entities` (people/concepts/organizations), `documents`, `meetings`, `tasks`, and decisions (modeled as `notes` with `note_type = 'decision'`). Edges live in `relationships` with a `relation_kind` enum: `mentions`, `relates_to`, `blocks`, `part_of`, `attended_by`, `decided_in`, `authored_by`, `references`.

The graph evolves automatically because two pipeline nodes write to it on every single capture: `identify_project` (links new content into a project) and `link_related_notes` (links it to similar existing content by embedding similarity, catching connections a keyword search would miss). Agents add edges too, the Planner Agent's task decomposition writes `part_of` edges from subtasks to their parent goal, the Review Agent's summaries write `references` edges back to what they summarized.

Traversal for the graph view is a recursive CTE bounded to depth 2-3 from a focus node:

```sql
with recursive graph_walk(source_type, source_id, target_type, target_id, depth) as (
  select source_type, source_id, target_type, target_id, 1
  from relationships
  where user_id = :user_id and source_type = :focus_type and source_id = :focus_id
  union
  select r.source_type, r.source_id, r.target_type, r.target_id, gw.depth + 1
  from relationships r
  join graph_walk gw on r.source_id = gw.target_id
  where gw.depth < 3 and r.user_id = :user_id
)
select distinct * from graph_walk;
```

Rendered client-side as a force-directed graph (`react-force-graph` or similar), with node-type filters and a focus mode that dims everything outside the current traversal so the view stays legible as the graph grows into the hundreds of nodes.

---

## 15. Task Scheduling Algorithm

Deterministic and explainable first, AI-assisted second. The Workflow Agent invokes this algorithm and narrates the result, it is never a silent background process the user can't reason about.

1. **Build the candidate set:** tasks with `status = 'open'`, all rows in `task_dependencies` for that task pointing to already-`done` tasks.
2. **Score each candidate:** `urgency` (days to deadline, curved so overdue and due-today dominate), `priority` (user-set 1-5), `project_weight` (parent project's own priority). Combined via the user's `scheduler_weights` (Settings, defaults `urgency 0.5, priority 0.3, project_weight 0.2`).
3. **Build the availability model:** working hours (`profiles.working_hours`) minus existing `time_blocks` minus any calendar-blocked time, split into slots tagged by `profiles.energy_profile`.
4. **Greedy placement:** walk scored tasks highest to lowest, place each into the earliest slot whose remaining duration covers `estimated_minutes` and whose energy tag is greater than or equal to the task's `energy_level`. Insert a configurable buffer (default 10 minutes) between placements.
5. **Cannot place:** if no slot before the deadline fits, do not force it in, mark `status = 'at_risk'` and surface it on the Dashboard and the project's `risks` field rather than silently overcommitting the day.
6. **Missed-task pass** (worker job, hourly): any `time_blocks` row whose `ends_at` has passed while its task is still not `done` is marked `missed`, released, and the task re-enters the candidate set for the next placement run. If it was a dependency for other tasks, their earliest possible start shifts forward, which can cascade into the parent project's `target_date` being flagged at risk too.

Example decomposition the Planner Agent produces for a stated goal, illustrating what feeds step 1 above:

```
"Launch MyLMS"
  -> Planning        (parent task, part_of the project)
       - Define MVP scope
       - Write requirements doc
  -> Development
       - Build auth
       - Build course player
       - Build admin panel
  -> Testing
       - Write test plan
       - Run QA pass
  -> Deployment
       - Set up production infra
       - Deploy and smoke test
  -> Documentation
       - Write user guide
       - Write API docs
```

Each leaf becomes a `tasks` row, each group becomes a `part_of` relationship to a parent task or directly to the project, and dependencies are inferred where they're structurally obvious (Testing depends on Development) and left for user confirmation where they're not.

---

## 16. MVP Roadmap

Scoped to one person's complete loop, single-agent-surface, one external AI vendor, no external calendar integration. Phased by dependency order, not calendar dates (team size and pace vary, the ordering below is what matters):

**Phase 0, Foundation:** repo scaffold (Section 8 structure), Supabase project (self-hosted, Section 4 schema, RLS applied), auth flow end to end, Docker Compose skeleton running all services locally.

**Phase 1, Capture and Notes:** Inbox (text and URL first, then voice/image/PDF), the full 11-step pipeline for text/URL captures, Notes with markdown, backlinks, and the pipeline's generated summaries and tags visible.

**Phase 2, Tasks, Projects, Calendar:** Tasks and Projects CRUD, `create_task_if_needed` wired into the pipeline, the scheduling algorithm (Section 15) and internal Calendar view, the missed-task pass running on schedule.

**Phase 3, Agents and Workspace:** Memory, Planner, Writer, and Review agents live, AI Workspace chat with SSE streaming, Planner-driven goal decomposition (the MyLMS example) working end to end.

**Phase 4, Reviews, Graph, Billing:** Daily and weekly review generation, Knowledge Graph view, Stripe billing (Checkout, webhook handling, tier enforcement), Settings complete, production deployment (Section 18).

Voice/image/PDF capture, while listed under Phase 1, can slip to the tail of Phase 1 if it threatens the phase's timeline, text and URL capture alone already exercises the full pipeline and is enough to validate the core loop.

---

## 17. V2 Roadmap

Deferred deliberately, not because they're unimportant, but because each adds an integration surface or a trust threshold the MVP shouldn't be gated on:

- **Research Agent:** needs outbound web fetch and document comparison across sources, a distinct integration surface from everything else in the MVP.
- **Workflow Agent autonomous triggers:** MVP ships it as a manual "check my projects" action, v2 automates the trigger (scheduled monitoring) once its suggestions have a track record the user trusts.
- **Google Calendar two-way sync:** OAuth, conflict resolution between the app's internal schedule and external events, push and pull.
- **Team and org workspaces:** multi-user projects, shared knowledge graphs, permissions, a meaningfully different data model (introduces `org_id` boundaries alongside `user_id`).
- **Monthly review:** a rollup over weekly reviews, straightforward once weekly review has real usage data to validate the format against.
- **Mobile app:** native or React Native capture-first client, once the capture and pipeline UX is proven on web.
- **Browser extension for capture:** one-click capture from any webpage.
- **Public API:** for users who want to script their own capture sources.
- **Data export and local sync:** Obsidian-style local markdown export/import, for users who want portability guarantees.

---

## 18. Production Deployment Strategy

**Environments:** local (docker-compose, all services including self-hosted Supabase), staging (same Compose stack on a small VPS, seeded with anonymized-ish test data), production (a separate VPS, same Compose stack, real data, restricted SSH access).

**Containers:** `web` (Next.js standalone output), `api` (FastAPI, Uvicorn), `worker` (Python polling loop), plus the self-hosted Supabase stack (Postgres, GoTrue, PostgREST, Storage, Realtime, Kong) as its own Compose file, and a reverse proxy (Caddy) in front of everything handling automatic HTTPS and routing `app.domain` to `web`, `api.domain` to `api`.

**CI/CD (GitHub Actions):**
1. On every PR: lint, type-check, unit tests for `ai_core` (pytest) and `web` (vitest/playwright for critical flows).
2. On merge to `main`: build and tag Docker images for `web`, `api`, `worker`, push to a container registry.
3. Deploy step: SSH into the target VPS, `docker compose pull && docker compose up -d`, run pending Supabase migrations (`supabase db push`) before bringing up `api`/`worker` so schema and code stay in lockstep.
4. A brief recreate-based deploy (not blue-green) is acceptable at MVP scale, a few seconds of downtime during a low-traffic deploy window beats the operational complexity of blue-green on a single VPS this early.

**Secrets:** never committed, `.env` files per environment, injected at container start. Production secrets (Gemini API key, Stripe keys, Supabase service role key, JWT verification config) live only on the production host, staging and local use separate, lower-privilege keys where the provider supports it (Stripe test mode keys, a separate Gemini key with its own quota).

**Backups:** nightly `pg_dump` of the Postgres database to object storage (Supabase Storage or an external bucket), retained on a rolling window (e.g. 14 daily, 8 weekly), plus a documented restore procedure that's actually been tested, not just written.

**Observability:** structured JSON logs from all three app containers, an error tracker (Sentry or equivalent) wired into both `web` and `api`, and a simple external uptime check against `/health` on `api` and the root of `web`, alerting if either goes down.

**Scaling path:** the pieces designed to be swapped without touching business logic if a single VPS stops being enough: the Postgres-backed job queue can move to Redis-backed (`worker` and `jobs`-writers change, `ai_core` graphs don't), and the single Postgres instance can move to managed Supabase Cloud (a connection string change, the schema and RLS policies are already Supabase-native). Both are explicitly deferred until real usage data says they're needed, not built in speculatively.

---

## Open Questions (tracked, not blocking)

- Which speech-to-text path Gemini's audio input takes for voice capture (direct audio upload versus a dedicated transcription call) needs a short spike once Phase 1 voice capture is being built, current assumption is Gemini handles audio input directly.
- Exact confidence thresholds for `identify_project` and `link_related_notes` (Section 12) are starting guesses, expected to be tuned against real usage during Phase 1 and 2.
