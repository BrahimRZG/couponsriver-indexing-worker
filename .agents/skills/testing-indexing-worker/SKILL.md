---
name: testing-indexing-worker
description: End-to-end test recipe for the standalone couponsriver-indexing-worker. Use when verifying any change that touches sitemap crawling, content hashing, URL state in SQLite, or IndexNow submission. Covers idempotency, DRY_RUN suppression, and the missing-INDEXNOW_KEY safety check.
---

# Testing the couponsriver-indexing-worker

The worker is a Node 20 + TypeScript CLI with no UI. All testing is shell-only — do **not** start a screen recording. Run everything from the repo root: `/home/ubuntu/repos/couponsriver-indexing-worker` (path may differ in future sessions; rely on the repo name).

## Required setup

```bash
npm ci
npm run check
npm run build
```

There is no preview deployment and no auth required — testing hits the public `https://couponsriver.com` site over HTTPS.

## Three-test plan (covers the spec end-to-end)

### T1 — Live dry-run is idempotent (primary flow)

```bash
rm -f data/indexing.sqlite data/indexing.sqlite-*
DRY_RUN=true MAX_URLS_PER_RUN=15 CONCURRENCY=3 npm run --silent run:once
DRY_RUN=true MAX_URLS_PER_RUN=15 CONCURRENCY=3 npm run --silent run:once
```

Expected (exact field values in the printed summary):

- Run A: `Sitemaps discovered: 2`, `URLs discovered: 392` (drifts as the site adds pages — assert `> 100`), `URLs fetched: 15`, `New URLs: 15`, `Changed URLs: 0`, `Unchanged URLs: 0`, `Submitted to IndexNow: 0`.
- Run B: `URLs fetched: 15`, `New URLs: 0`, `Changed URLs: 0`, `Unchanged URLs: 15`, `Submitted to IndexNow: 0`.
- `sqlite3 data/indexing.sqlite 'SELECT COUNT(*) FROM urls'` → 15 (or `better-sqlite3` from node — sqlite3 CLI is not always installed).

If Run B reports any `Changed URLs > 0`, the Cloudflare normalization in `src/hash.ts` likely regressed. The site injects `__CF$cv$params={...}`, `data-cfemail="..."` tokens, `email-protection#...` hashes, and a `beacon.min.js` script whose ordering rotates per request — `src/hash.ts` strips/replaces all of these before hashing.

### T2 — DRY_RUN suppresses every IndexNow POST and filters off-origin URLs

Write a probe that imports `submitToIndexNow` directly and patches `globalThis.fetch`:

```ts
// /tmp/probe.ts
import { submitToIndexNow } from "<repo>/src/indexnow";
import type { AppConfig } from "<repo>/src/types";
const calls: string[] = [];
const orig = globalThis.fetch;
globalThis.fetch = (async (input: unknown) => {
  calls.push(typeof input === "string" ? input : (input as { url?: string }).url ?? String(input));
  return orig(input as RequestInfo);
}) as typeof fetch;
const cfg: AppConfig = {
  targetSite: "https://couponsriver.com", targetOrigin: "https://couponsriver.com",
  targetHost: "couponsriver.com", indexNowKey: "fake", indexNowKeyLocation: "x",
  maxUrlsPerRun: 5, concurrency: 1, requestTimeoutMs: 5000, userAgent: "test",
  databasePath: "/tmp/x.sqlite", dryRun: true, bingWebmasterApiKey: "",
};
async function main() {
  const r = await submitToIndexNow([
    "https://couponsriver.com/a",
    "https://couponsriver.com/b",
    "https://evil.example.com/c",  // must be filtered
  ], cfg);
  console.log("attempted:", r.attempted, "submitted:", r.submitted,
              "submittedUrls:", r.submittedUrls.length,
              "api.indexnow calls:", calls.filter(u => u.includes("api.indexnow.org")).length);
}
main();
```

Run with `npx tsx /tmp/probe.ts`. Wrap top-level await in an `async function main()` — tsx with the project's `tsconfig.json` emits CJS and rejects top-level await.

Expected: `attempted: 2`, `submitted: 0`, `submittedUrls: 0`, `api.indexnow calls: 0`.

### T3 — Live-mode safety check (no INDEXNOW_KEY → fail fast)

```bash
DRY_RUN=false INDEXNOW_KEY= MAX_URLS_PER_RUN=5 DATABASE_PATH=./data/never.sqlite npm run --silent run:once ; echo "exit=$?"
```

Expected: stderr contains exactly `Error: INDEXNOW_KEY is required when DRY_RUN=false. Set DRY_RUN=true or provide a key.` and `exit=1`. The throw is at `src/config.ts` inside `loadConfig`, which runs before any network code, so no requests are made.

Also verify `INDEXNOW_KEY="   "` (whitespace-only) trips the same check — `config.ts` `.trim()`s the value before the length check.

## Gotchas

- **Cloudflare hash stability**: if you change `src/hash.ts`, re-run T1 to confirm Run B still reports 15 `Unchanged URLs`. The normalizer needs to keep stripping `cloudflareinsights/beacon.min.js`, `challenge-platform`, `__CF$cv$params`, `data-cfemail`, `email-protection#...`, and any new CSP nonces.
- **Origin lock**: `src/sitemap.ts` uses `new URL(url).origin === targetOrigin` (not `startsWith`). Lookalike hosts like `couponsriver.com.evil.com` must be rejected. `src/indexnow.ts` and `src/fetchPage.ts` also re-check the origin at submission and post-redirect time.
- **Sync throws in the limiter**: `src/limiter.ts` wraps the callback as `Promise.resolve().then(fn)` so a sync throw still decrements `active`. If you refactor it, regression-test with a callback that `throw`s synchronously and then 5 normal callbacks at `maxConcurrent=2`.
- **MAX_URLS_PER_RUN hard cap**: config-load rejects values > 500. Don't try to override this for stress testing — file an explicit follow-up instead. This is a Stop Condition in the spec.
- **`tsx` + top-level await**: the project's `tsconfig.json` targets CJS, so probes need an explicit `async function main()` wrapper.

## Live-mode submission is out of scope

Do NOT run with `DRY_RUN=false` and a real `INDEXNOW_KEY` from a Devin session. Live submission requires the key file to be hosted at `https://couponsriver.com/indexnow-key.txt` first (handled in the Astro website repo, not here). This is an explicit Stop Condition in the original spec.

## Devin Secrets Needed

None for dry-run testing (T1/T2/T3 don't need any secrets). Live mode would need `INDEXNOW_KEY` saved as an org-scope secret — request `INDEXNOW_KEY_COUPONSRIVER` if the user explicitly asks for a live test.
