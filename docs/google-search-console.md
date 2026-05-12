# Google Search Console (not Google Indexing API)

This worker does **not** use the Google Indexing API.

## Why not

Google's [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart) is only intended for:

- `JobPosting` structured data
- `BroadcastEvent` structured data for live videos

CouponsRiver's coupon and tool pages are **neither** of those. Using the Indexing API on non-eligible pages:

- Provides no real indexing benefit (Google has explicitly said so).
- Risks suspension of the Indexing API service account / project.
- Can be interpreted as policy abuse if done at scale.

So this worker intentionally skips Google's API.

## What to do instead for Google

Use Google Search Console (GSC):

1. Verify ownership of `https://couponsriver.com` in [Google Search Console](https://search.google.com/search-console).
2. Open **Sitemaps** in the left nav.
3. Add the sitemap index URL:

   ```
   https://couponsriver.com/sitemap-index.xml
   ```

4. Confirm GSC shows it as **Success** and lists the child sitemap files.
5. For high-priority single-URL discovery, use the **URL Inspection** tool in GSC and click **Request indexing**. This is a manual one-URL-at-a-time action; do not script it.

## How this worker helps Google indirectly

- It keeps the local notion of "what URLs exist on the site" up to date.
- It detects new/changed pages so you know when to (re)request indexing in GSC.
- It does not, and cannot, force Google to index anything.

## Internal SEO hygiene that actually moves the needle

- A valid, fresh sitemap (already in place).
- Correct `<link rel="canonical">` on every page.
- Reasonable internal linking from index/category pages to leaf pages.
- Fast HTML responses (no JS-only rendering of primary content).
- Avoiding soft-404s.

None of those are this worker's job — they live in the website repo.
