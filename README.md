# couponsriver-indexing-worker

A standalone, safe indexing automation worker for [couponsriver.com](https://couponsriver.com).

It reads the live sitemap, detects new or changed URLs, stores URL state in a local SQLite database, and submits eligible URLs to **Bing IndexNow**. It does **not** force Google indexing, run browser automation, or scrape search engines.

This project is **separate** from the CouponsRiver Astro website repo. It must not modify the website repo.

---

## What this worker does

1. Fetches `https://couponsriver.com/robots.txt` and reads `Sitemap:` lines.
2. Crawls sitemap index files and individual sitemap files.
3. Extracts page URLs (HTML pages only).
4. Fetches each page (with a concurrency limit, timeouts, and retries for transient errors).
5. Computes a SHA-256 hash of the normalized HTML.
6. Stores per-URL state in SQLite: first seen, last seen, last status, last hash, change/submit counts, last error.
7. Classifies URLs as `new`, `changed`, `unchanged`, or `failed`.
8. Submits new/changed URLs to the [IndexNow](https://www.indexnow.org/) endpoint (`https://api.indexnow.org/indexnow`), batched at 100 URLs per request.
9. Prints a clear per-run summary.

## What this worker does NOT do

- **No Google Indexing API.** Google's Indexing API is intended for `JobPosting` and `BroadcastEvent` content, not regular coupon/tool pages. Using it on non-eligible pages risks API key suspension and provides no real indexing benefit. See [`docs/google-search-console.md`](docs/google-search-console.md) for the correct Google approach.
- **No browser automation.** This is a pure HTTP fetcher with a Node `fetch` client.
- **No scraping of Google/Bing search result pages.**
- **No forced indexing claims.** IndexNow is a hint, not a guarantee.
- **No crawl of URLs outside `couponsriver.com`.** The worker validates origin on every fetch and submission.
- **No infinite loop.** Each invocation runs once and exits. Schedule it externally (cron, Render cron, Railway scheduled job, etc.).

---

## Requirements

- Node.js **20+** (tested on 20 LTS and 22).
- npm 10+.
- A writable directory for the SQLite database (defaults to `./data/indexing.sqlite`).

## Install

```bash
npm install
```

## Configure

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables:

| Variable | Default | Notes |
|---|---|---|
| `TARGET_SITE` | `https://couponsriver.com` | Must be HTTPS. Other origins are rejected. |
| `INDEXNOW_KEY` | _(empty)_ | Required in live mode. Plain string (UUID-style recommended). |
| `INDEXNOW_KEY_LOCATION` | `https://couponsriver.com/indexnow-key.txt` | Must be reachable and return the key as plain text. |
| `MAX_URLS_PER_RUN` | `500` | Hard cap. Stop condition: do not exceed 500. |
| `CONCURRENCY` | `5` | Page-fetch concurrency. |
| `REQUEST_TIMEOUT_MS` | `15000` | Per-request timeout for fetches and submissions. |
| `USER_AGENT` | `CouponsRiverIndexingWorker/1.0 (+https://couponsriver.com)` | Sent on all requests. |
| `DATABASE_PATH` | `./data/indexing.sqlite` | Local SQLite file. Ignored by git. |
| `DRY_RUN` | `true` | When true, no submissions are sent. **Default is dry-run for safety.** |
| `BING_WEBMASTER_API_KEY` | _(empty)_ | Optional. Not used by default; IndexNow is the primary path. |

## Run in dry mode (safe default)

```bash
DRY_RUN=true npm run run:once
```

This will:

- Crawl the sitemap.
- Fetch pages and compute hashes.
- Update local SQLite state.
- Log which URLs **would** be submitted, **without** calling IndexNow.

## Run in live mode

1. Generate an IndexNow key (any 8–128 char hex/alphanumeric string is acceptable; commonly a UUID).
2. Host the key at `https://couponsriver.com/indexnow-key.txt` (see [`docs/indexnow-setup.md`](docs/indexnow-setup.md)).
3. Set the matching `INDEXNOW_KEY` value in `.env`.
4. Run:

   ```bash
   DRY_RUN=false npm run run:once
   ```

## Build

```bash
npm run build      # emits dist/
npm run check      # typecheck only, no emit
npm start          # runs dist/index.js (after build)
```

---

## Deployment

This worker needs **persistent SQLite state** between runs. See [`docs/deployment.md`](docs/deployment.md) for recommendations:

- VPS with `cron`
- Render scheduled job with persistent disk
- Railway scheduled job with a mounted volume
- Fly.io machine with a volume

**Not recommended:** Cloudflare Pages, Netlify, Vercel serverless, or GitHub Actions without artifact-based state — these either cannot host a long-lived SQLite file or lose state between runs.

---

## Inspect the SQLite database

```bash
sqlite3 ./data/indexing.sqlite

sqlite> .tables
sqlite> SELECT url, last_status, change_count, submit_count, last_seen_at
        FROM urls
        ORDER BY last_seen_at DESC
        LIMIT 20;
sqlite> SELECT * FROM runs ORDER BY id DESC LIMIT 5;
```

## Reset state safely

```bash
# Just remove the DB file; the next run recreates it.
rm -f ./data/indexing.sqlite ./data/indexing.sqlite-*
```

## Avoid over-submitting URLs

- Keep `MAX_URLS_PER_RUN` ≤ 500 (the worker enforces this).
- Schedule no more often than the site actually changes (e.g. hourly is plenty for a static coupon site; daily is usually appropriate).
- The worker only submits **new** or **changed** URLs — unchanged URLs are never re-submitted.
- IndexNow batches are capped at 100 URLs per request.

---

## IndexNow key file on the website repo

The website repo (Astro/Cloudflare Pages) should host the IndexNow key at:

```
https://couponsriver.com/indexnow-key.txt
```

To do that, add a file at `public/indexnow-key.txt` in the Astro repo whose plain-text content is exactly the key. See [`docs/indexnow-setup.md`](docs/indexnow-setup.md) for full instructions. **Do not commit a real key to this worker repo.**

---

## Security

- `.env` is ignored.
- The SQLite database is ignored.
- The logger redacts `INDEXNOW_KEY`, `BING_WEBMASTER_API_KEY`, and `GOOGLE_PRIVATE_KEY` values from log output if they appear anywhere.
- URLs are validated against `TARGET_SITE` before any fetch or submission.
- Only HTTPS targets are allowed.

## Project layout

```
couponsriver-indexing-worker/
  package.json
  tsconfig.json
  .gitignore
  .env.example
  README.md
  src/
    index.ts          # orchestrator (single run, then exit)
    config.ts         # env loading + validation
    logger.ts         # structured logger with secret redaction
    robots.ts         # robots.txt fetch + Sitemap: parsing
    sitemap.ts        # sitemap index + urlset crawling (fast-xml-parser)
    fetchPage.ts      # HTTPS page fetch, timeouts, retry on 429/5xx
    hash.ts           # SHA-256 of normalized HTML
    db.ts             # better-sqlite3 schema + queries
    indexnow.ts       # IndexNow batch submitter
    limiter.ts        # tiny concurrency limiter
    types.ts          # shared types
  docs/
    deployment.md
    google-search-console.md
    indexnow-setup.md
  .github/workflows/
    indexing-worker.yml.example   # opt-in example workflow (NOT active)
```
