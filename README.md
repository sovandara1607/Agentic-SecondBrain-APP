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
