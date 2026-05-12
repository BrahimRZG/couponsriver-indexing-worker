# Deployment guide

The worker stores per-URL state in a local SQLite database. **State must persist between runs.** Without persistence, every URL looks "new" on each run, which can over-submit to IndexNow.

## Recommended

### Small VPS with cron

```cron
# Run once an hour, write log to /var/log/indexing-worker.log
0 * * * * cd /opt/couponsriver-indexing-worker && /usr/bin/node dist/index.js >> /var/log/indexing-worker.log 2>&1
```

Setup:

```bash
git clone https://github.com/BrahimRZG/couponsriver-indexing-worker.git
cd couponsriver-indexing-worker
npm ci
npm run build
cp .env.example .env
# edit .env: set INDEXNOW_KEY, DRY_RUN=false when ready
mkdir -p data
```

### Render cron job (with persistent disk)

1. Create a **Cron Job** service in Render.
2. Build command: `npm ci && npm run build`.
3. Command: `node dist/index.js`.
4. Schedule: e.g. `0 * * * *`.
5. Attach a **persistent disk** mounted at `/opt/render/project/src/data` (or wherever `DATABASE_PATH` points).
6. Add environment variables from `.env.example` (set real `INDEXNOW_KEY`, `DRY_RUN=false`).

### Railway scheduled job (with volume)

1. Create a new Railway service from this repo.
2. Add a **Volume** mounted at `/app/data`.
3. Set start command: `node dist/index.js`.
4. Add a **Cron** trigger (e.g. hourly).
5. Set environment variables.

### Fly.io with a volume

```bash
fly launch --no-deploy
fly volumes create indexing_data --size 1
# In fly.toml, mount the volume at /app/data
fly deploy
fly machine run --schedule hourly 'node dist/index.js'
```

## Not recommended

| Platform | Why not |
|---|---|
| Cloudflare Pages | No long-lived disk; serverless cold starts; no SQLite persistence. |
| Netlify static hosting | Same — no backend persistence. |
| Vercel serverless functions | Ephemeral filesystem; SQLite state is lost between invocations. |
| GitHub Actions (without state) | Each run starts on a fresh runner; without uploading/downloading the SQLite file as an artifact, all URLs look "new" every run. See `docs/indexnow-setup.md` for the optional artifact-based pattern. |

## Choosing a schedule

A static coupon site does not change often. Reasonable choices:

- Hourly during active editing periods.
- Daily for steady-state operation.
- Manual one-shot after a deploy that changes many pages.

The worker only submits **new** or **changed** URLs, so over-running it is cheap, but submitting the same unchanged URLs to IndexNow repeatedly is wasteful even if technically allowed.
