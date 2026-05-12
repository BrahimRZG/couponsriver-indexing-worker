# Cloudflare Worker Deployment Guide

This guide explains how to deploy the CouponsRiver indexing worker to Cloudflare Workers with a D1 database and a daily Cron Trigger.

---

## Overview

| Component | Details |
|---|---|
| Runtime | Cloudflare Workers (edge) |
| Database | Cloudflare D1 (SQLite-compatible) |
| Schedule | Cron Trigger — `0 3 * * *` (03:00 UTC daily) |
| Entrypoint | `src/worker.ts` |
| Config loader | `src/worker-config.ts` (reads env bindings) |
| DB adapter | `src/db-d1.ts` (async D1 calls) |

---

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- Wrangler v3+: `npm install -g wrangler`
- A Cloudflare account with Workers and D1 enabled
- `wrangler login` completed

---

## Step 1 — Create the D1 database

```bash
wrangler d1 create couponsriver-indexing-db
```

Copy the `database_id` from the output. You will need it in the next step.

---

## Step 2 — Create wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and replace the placeholder:

```toml
[[d1_databases]]
binding       = "DB"
database_name = "couponsriver-indexing-db"
database_id   = "<paste your database_id here>"
```

> **Do not commit `wrangler.toml` if it contains a real `database_id`.**  
> Add `wrangler.toml` to `.gitignore` if this is a public repository,  
> or use the provided example file only.

---

## Step 3 — Apply D1 migrations

Apply the schema to the **remote** (production) D1 database:

```bash
wrangler d1 migrations apply couponsriver-indexing-db
```

Apply to a **local** D1 database for development:

```bash
wrangler d1 migrations apply couponsriver-indexing-db --local
```

The migration file is at `migrations/0001_initial.sql`. It creates the `urls` and `runs` tables that match the existing SQLite schema used by the CLI worker.

---

## Step 4 — Add INDEXNOW_KEY as a Cloudflare secret

The IndexNow key **must never** be committed to source control. Add it as an encrypted Worker secret:

```bash
wrangler secret put INDEXNOW_KEY
# → You will be prompted to type or paste the key value.
```

Verify it was stored:

```bash
wrangler secret list
```

---

## Step 5 — Deploy with Wrangler

```bash
wrangler deploy
```

This bundles `src/worker.ts` (and its imports) and uploads it to Cloudflare.

---

## Step 6 — Enable the Cron Trigger

The cron schedule is declared in `wrangler.toml`:

```toml
[triggers]
crons = ["0 3 * * *"]
```

After deploying, verify the trigger is registered in the Cloudflare dashboard under  
**Workers & Pages → your worker → Triggers → Cron Triggers**.

The worker runs once daily at **03:00 UTC**.

---

## Testing with DRY_RUN=true

The default configuration has `DRY_RUN = "true"` in `wrangler.toml`. In dry-run mode:

- The sitemap is crawled and pages are fetched normally.
- New/changed URLs are logged but **not submitted** to IndexNow.
- No data is written to `last_submitted_at` or `submit_count` in D1.

To trigger the worker manually without waiting for the cron schedule:

```bash
# Invoke the scheduled handler locally (uses --local D1)
wrangler dev --test-scheduled
# then in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+3+*+*+*"
```

Or trigger against the deployed worker:

```bash
# Requires Workers Cron Trigger manual invocation from the dashboard:
# Workers & Pages → your worker → Triggers → Test → Run
```

---

## Going live (DRY_RUN=false)

Once you are satisfied with dry-run results:

1. Edit `wrangler.toml`: set `DRY_RUN = "false"`.
2. Confirm `INDEXNOW_KEY` secret is set (`wrangler secret list`).
3. Deploy: `wrangler deploy`.
4. Monitor logs: `wrangler tail`.

> **MAX_URLS_PER_RUN is capped at 500** (enforced in code). The wrangler.toml example sets it to 25 as a conservative starting point. Increase gradually after validating behaviour.

---

## Environment variable reference

| Binding / Var | Type | Default | Notes |
|---|---|---|---|
| `DB` | D1 binding | — | Required. Set in `[[d1_databases]]`. |
| `TARGET_SITE` | var | `https://couponsriver.com` | Target site URL. |
| `INDEXNOW_KEY_LOCATION` | var | `https://couponsriver.com/indexnow-key.txt` | Public URL of your IndexNow key file. |
| `DRY_RUN` | var | `"true"` | Set to `"false"` to enable live submissions. |
| `MAX_URLS_PER_RUN` | var | `"25"` | Max 500. |
| `CONCURRENCY` | var | `"2"` | Parallel fetch slots. Max 16. |
| `REQUEST_TIMEOUT_MS` | var | `"15000"` | Per-request timeout in ms. |
| `USER_AGENT` | var | (default string) | Optional custom user-agent. |
| `INDEXNOW_KEY` | **secret** | — | Set with `wrangler secret put INDEXNOW_KEY`. |

---

## CLI (Node) mode

The original CLI worker is unchanged. It still runs with Node 20 + better-sqlite3:

```bash
cp .env.example .env
# edit .env as needed (DRY_RUN=true by default)
npm run dev
```

---

## Architecture notes

- `src/worker.ts` — Cloudflare Worker entrypoint (scheduled + fetch handlers).
- `src/worker-indexer.ts` — Worker-mode indexing pipeline (mirrors `src/index.ts`).
- `src/worker-config.ts` — Config loader for Worker env bindings (no Node APIs).
- `src/db-d1.ts` — Async D1 adapter (mirrors `src/db.ts` interface).
- `src/hash.ts` — Uses `globalThis.crypto.subtle` (Web Crypto API, works in both Node 20 and Workers).
- `src/logger.ts` — Runtime-agnostic; call `logger.setEnv(env)` in Worker mode for secret redaction.
- `migrations/0001_initial.sql` — D1 migration matching the existing SQLite schema.
- `wrangler.toml.example` — Template config (copy to `wrangler.toml`, never commit with real IDs).
- `tsconfig.worker.json` — Separate TypeScript config for Worker type-checking (`@cloudflare/workers-types`).
