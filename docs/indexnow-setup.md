# IndexNow setup

This worker uses the [IndexNow](https://www.indexnow.org/) protocol to notify Bing (and other participating engines) of new or changed URLs.

## 1. Pick a key

Generate any random string between 8 and 128 characters, hex or alphanumeric. A UUIDv4 with the dashes removed is a fine choice:

```bash
node -e "console.log(require('node:crypto').randomUUID().replace(/-/g, ''))"
```

Treat this key as a low-sensitivity shared secret. It is sent on every IndexNow request and must match the file hosted on your domain.

**Do not commit the real key to this repository.** Add it only to your local `.env` and to your deployment platform's secret store.

## 2. Host the key file on the CouponsRiver website

The website repo is the **Astro** project for `couponsriver.com`. Add a static file:

```
public/indexnow-key.txt
```

Its content must be **exactly** the key, with no surrounding whitespace, no quotes, and no newline-only file. For example, if the key is `abc123...`:

```
abc123...
```

Deploy the site. Then verify the file is reachable as plain text:

```bash
curl -i https://couponsriver.com/indexnow-key.txt
# Expect 200 OK and a Content-Type of text/plain
```

The URL must match `INDEXNOW_KEY_LOCATION` in this worker's `.env`:

```
INDEXNOW_KEY_LOCATION=https://couponsriver.com/indexnow-key.txt
```

## 3. Set the worker's environment

In this worker's `.env`:

```
INDEXNOW_KEY=<the same key you put in the file>
INDEXNOW_KEY_LOCATION=https://couponsriver.com/indexnow-key.txt
DRY_RUN=true
```

Run a dry run first to confirm discovery and hashing work:

```bash
npm run run:once
```

You will see lines like:

```
[DRY_RUN] Would submit N URL(s) to IndexNow in M batch(es)
[DRY_RUN] candidate: https://couponsriver.com/...
```

## 4. Go live

Once dry-run looks correct, flip:

```
DRY_RUN=false
```

And run again:

```bash
npm run run:once
```

A successful IndexNow submission returns HTTP 200 or 202 with no body. A `403` typically means the key file is missing, mismatched, or returns the wrong Content-Type.

## 5. Per-engine notes

- **Bing**: IndexNow submissions go directly to Bing.
- **Yandex**: Also accepts IndexNow.
- **Google**: Does **not** participate in IndexNow. Use Google Search Console (see [`google-search-console.md`](google-search-console.md)).

## 6. Rate limiting / hygiene

- Max 100 URLs per JSON batch (enforced by the worker).
- The worker only submits URLs whose content has changed since the last run.
- Schedule the worker no more often than the site actually changes; hourly or daily is plenty.
- Never submit URLs outside `couponsriver.com` — the worker filters these, but do not try to bypass it.
