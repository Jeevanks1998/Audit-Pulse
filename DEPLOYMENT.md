# Deploying AuditPulse: GitHub → Railway (backend) → Vercel (frontend)

This repo is a monorepo: static frontend at the root, FastAPI backend in
`backend/`. They deploy to two different platforms and are wired together
with one environment variable.

## 1. Push to GitHub

```bash
cd AuditPulse_project/project
git init
git add .
git commit -m "Initial commit: AuditPulse"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(Create the empty repo on GitHub first, or via `gh repo create`.)

## 2. Backend on Railway

Railway reads `backend/Dockerfile` directly — no extra config needed beyond
pointing it at the right subfolder.

1. **New Project → Deploy from GitHub repo** → select this repo.
2. Click the created service → **Settings → Root Directory** → set to
   `backend`. Railway will now build `backend/Dockerfile`.
3. **Add databases**: in the same project, click **+ New → Database →
   PostgreSQL**, and again for **Redis**. Railway auto-injects
   `DATABASE_URL` / `REDIS_URL`-style variables you'll reference below.
4. On the **backend service → Variables**, set:
   - `DATABASE_URL` → `postgresql+asyncpg://...` (copy from the Postgres
     service's connection info, but change the driver prefix from
     `postgresql://` to `postgresql+asyncpg://` — Railway's default string
     uses the sync driver, this app needs the async one)
   - `REDIS_URL` → `${{Redis.REDIS_URL}}` (Railway variable reference)
   - `CELERY_BROKER_URL` → same as `REDIS_URL`
   - `CELERY_RESULT_BACKEND` → same Redis URL with `/1` instead of `/0` at
     the end
   - `SECRET_KEY` → generate one: `openssl rand -hex 32`
   - `DEBUG` → `False`
   - `CORS_ORIGINS_RAW` → your Vercel URL, e.g.
     `https://your-app.vercel.app` (add it after step 3 once you know the
     domain; comma-separate if you also want localhost during testing)
   - Optional: `ANTHROPIC_API_KEY`, `GOOGLE_PAGESPEED_API_KEY`
5. Deploy. Railway builds the Dockerfile (installs deps + Playwright
   Chromium) and starts uvicorn per `backend/railway.json`. Grab the public
   URL from **Settings → Networking → Generate Domain**.
6. **Background jobs (required for audits to actually run):** add a second
   service in the same project — **+ New → GitHub Repo** → same repo again
   → **Root Directory** → `backend` → **Settings → Deploy → Start Command**
   → override to:
   ```
   celery -A workers.celery_worker worker --beat --loglevel=info
   ```
   Give it the same environment variables as the web service (Railway lets
   you copy variables between services in the same project). This process
   has no public domain — it just needs to reach the same Postgres/Redis.

Test it: `https://<your-backend>.up.railway.app/health` and
`/docs` should both load.

## 3. Frontend on Vercel

1. **Add New Project** on Vercel → import the same GitHub repo.
2. **Root Directory**: leave as the repo root (frontend files live there,
   `backend/` is ignored since Vercel only runs the build command below).
3. **Framework Preset**: "Other" (no framework — it's plain static HTML).
4. **Build Command**: `bash scripts/generate-env.sh`
5. **Output Directory**: `.` (repo root — the HTML files stay where they
   are, the build script just writes `assets/js/env.js`).
6. **Environment Variables** → add:
   - `BACKEND_API_URL` = `https://<your-backend>.up.railway.app/api/v1`
     (the Railway URL from step 2.5, with `/api/v1` appended)
7. Deploy.

Vercel's build step runs `scripts/generate-env.sh`, which writes
`assets/js/env.js` with `window.__AUDITPULSE_API_BASE__` set to your
Railway backend — every page loads that file before `config.js`, so the
whole frontend now points at the live backend automatically.

## 4. Close the loop

Once both are live, go back to the Railway backend's `CORS_ORIGINS_RAW`
variable and confirm it includes the exact Vercel domain Vercel assigned
(e.g. `https://auditpulse.vercel.app`), then redeploy the backend service
so CORS allows requests from it. Without this, the browser will block API
calls from the deployed frontend even though the backend is reachable.

Visit `https://<your-vercel-app>/login.html`, log in with any email +
6-character password (auto-registers on first use), and run an audit.

## Notes

- **Screenshots**: `backend/screenshots/` is written to local disk in the
  container. Railway's filesystem is ephemeral on redeploy, so screenshots
  won't persist across deploys — fine for demo use; for production, point
  `pdf/screenshots.py` at object storage (S3/R2) instead.
- **Migrations**: `init_db()` auto-creates tables on first boot, so no
  manual step is needed for a fresh Postgres instance. Alembic is present
  if you want real migrations later.
- **Local dev unaffected**: `docker-compose up --build` still works exactly
  as before — `assets/js/env.js`'s default fallback is empty, so
  `config.js` falls back to `http://localhost:8000/api/v1` untouched.
