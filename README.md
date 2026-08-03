# AuditPulse — AI Website Audit Platform

A full-stack app: a FastAPI backend (`/backend`) and a static HTML/JS/CSS
frontend (everything else in this folder). Both have been verified working
end-to-end, and the frontend now talks to the real backend (it previously
shipped as a `localStorage`-only mock).

## What's here

- `backend/` — FastAPI + async SQLAlchemy (Postgres) + Redis/Celery, with
  modules for crawling, SEO, accessibility, performance, AI summaries, PDF
  export, and more.
- `*.html`, `assets/` — the frontend (login, dashboard, audit, report,
  history, settings pages).
- `docker-compose.yml` — one-command startup (Postgres + Redis + backend +
  a static server for the frontend).

## Bugs fixed during verification

1. **`passlib` + `bcrypt` incompatibility** — `passlib==1.7.4`'s backend
   self-test crashes under `bcrypt>=4.1`, breaking every register/login
   call. Fixed by pinning `bcrypt==4.0.1` in `backend/requirements.txt`.
2. **`MissingGreenlet` on every audit** — `models/issue.py` accessed a
   lazy-loaded relationship (`audit.issues`) outside an async-safe context,
   failing every audit at the final "generate report" step. Fixed by
   querying `Issue` rows explicitly with `select(...)`.
3. **Frontend was disconnected from the backend** — `assets/js/api.js` was
   a self-contained mock backed by `localStorage`. It's been rewritten to
   call the real API (same `window.Api.auth/audits/settings` interface, so
   no page-level code changed) — see "How the frontend connects" below.

With both backend fixes applied, a full run (register → login → start
audit → poll progress → dashboard → settings) has been tested end-to-end
against a live Postgres + Redis + FastAPI instance.

## Quickest start: Docker Compose

```bash
docker compose up --build
```

- Backend: http://localhost:8000 (docs at `/docs`)
- Frontend: http://localhost:5500

## Manual setup

### 1. Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Postgres + Redis need to be running locally, matching the values below
cp .env.example .env

uvicorn main:app --reload
```

`init_db()` creates all tables automatically on startup — no manual
migration step needed for local dev (Alembic is there if you want real
migrations later).

### 2. Frontend

The frontend is static — any file server works:

```bash
# from the project root (not backend/)
python3 -m http.server 5500
```

Open http://localhost:5500/login.html — enter any email/password (6+
chars); the app auto-registers you on first login, since there's currently
no separate sign-up screen.

If you serve the frontend from a different origin/port, either add it to
`CORS_ORIGINS_RAW` in `backend/.env`, or point the frontend at a different
API by setting `window.__AUDITPULSE_API_BASE__` before `config.js` loads.

## How the frontend connects

`assets/js/config.js` defines `API_BASE_URL` (defaults to
`http://localhost:8000/api/v1`). `assets/js/api.js` implements the same
`window.Api = { auth, audits, settings }` interface the pages already call,
but now:

- `auth.login()` calls `POST /auth/login`, auto-registering via
  `POST /auth/register` on a first-time email (there's no dedicated sign-up
  UI yet).
- `audits.run()` calls `POST /audits/` then polls
  `GET /audits/{id}/progress` to drive the on-screen checklist/progress
  ring in real time.
- `audits.getStats()` / `getRecent()` call `GET /dashboard/`.
- `settings.*` calls `GET/PATCH /settings/`,
  `POST /settings/api-key/regenerate`, `GET /settings/export`.

**Known gap:** `report.html` renders a static demo report from hardcoded
markup — it isn't yet wired to fetch a specific audit's real data
(`GET /reports/{audit_id}`) by ID. Wiring that up is the natural next step
if you want the full loop (start audit → see *that* audit's real report).

## Optional API keys

Real crawling works without any keys. Two features are stubbed until you
add keys to `backend/.env`:

- `ANTHROPIC_API_KEY` — enables the AI-generated summaries/action plans in
  `backend/ai/`.
- `GOOGLE_PAGESPEED_API_KEY` — enables real PageSpeed-based performance
  scoring in `backend/performance/`.
