export interface AppConfig {
  targetSite: string;
  targetOrigin: string;
  targetHost: string;
  indexNowKey: string;
  indexNowKeyLocation: string;
  maxUrlsPerRun: number;
  concurrency: number;
  requestTimeoutMs: number;
  userAgent: string;
  databasePath: string;
  dryRun: boolean;
  bingWebmasterApiKey: string;
}

export interface SitemapEntry {
  loc: string;
  lastmod?: string;
}

export type UrlStatus = "new" | "changed" | "unchanged" | "failed";

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string | undefined;
  body: string | undefined;
  ok: boolean;
  error?: string;
}

export interface UrlRecord {
  url: string;
  last_seen_at: string;
  first_seen_at: string;
  last_submitted_at: string | null;
  last_status: number | null;
  last_hash: string | null;
  lastmod_from_sitemap: string | null;
  change_count: number;
  submit_count: number;
  last_error: string | null;
}

export interface RunCounters {
  sitemapsDiscovered: number;
  urlsDiscovered: number;
  fetched: number;
  newCount: number;
  changedCount: number;
  unchangedCount: number;
  failedCount: number;
  eligible: number;
  submitted: number;
  skipped: number;
}
