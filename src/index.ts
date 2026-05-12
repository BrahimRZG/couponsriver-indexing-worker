import { loadConfig } from "./config";
import { logger } from "./logger";
import { fetchRobots, isPathAllowed } from "./robots";
import { crawlSitemaps } from "./sitemap";
import { fetchPage, extractCanonical } from "./fetchPage";
import { hashHtml } from "./hash";
import { IndexingDb } from "./db";
import { submitToIndexNow } from "./indexnow";
import { createLimiter } from "./limiter";
import { AppConfig, RunCounters, SitemapEntry } from "./types";

const SKIP_EXTENSIONS = new Set([
  ".css",
  ".js",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".svg",
  ".ico",
  ".xml",
  ".txt",
  ".json",
  ".map",
  ".gif",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".pdf",
  ".mp4",
  ".mp3",
  ".zip",
]);

function getExtension(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const dot = path.lastIndexOf(".");
    const slash = path.lastIndexOf("/");
    if (dot <= slash) return "";
    return path.slice(dot).toLowerCase();
  } catch {
    return "";
  }
}

function isEligiblePageUrl(url: string, config: AppConfig): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.hostname !== config.targetHost) return false;
  if (u.pathname === "/robots.txt") return false;
  if (u.pathname.startsWith("/api/")) return false;
  if (u.pathname.startsWith("/_")) return false;
  if (u.pathname.includes("sitemap") && u.pathname.endsWith(".xml")) return false;
  const ext = getExtension(url);
  if (ext && SKIP_EXTENSIONS.has(ext)) return false;
  return true;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return url;
  }
}

interface ProcessedUrl {
  url: string;
  outcome: "new" | "changed" | "unchanged" | "failed" | "skipped";
  reason?: string;
}

async function processUrl(
  entry: SitemapEntry,
  config: AppConfig,
  db: IndexingDb,
): Promise<ProcessedUrl> {
  const normalizedUrl = normalizeUrl(entry.loc);
  const lastmod = entry.lastmod ?? null;
  const nowIso = new Date().toISOString();

  const result = await fetchPage(normalizedUrl, {
    userAgent: config.userAgent,
    timeoutMs: config.requestTimeoutMs,
    targetOrigin: config.targetOrigin,
  });

  if (!result.ok || !result.body) {
    db.recordFailure({
      url: normalizedUrl,
      nowIso,
      status: result.status,
      error: result.error ?? "unknown",
      lastmod,
    });
    return { url: normalizedUrl, outcome: "failed", reason: result.error };
  }

  const canonical = extractCanonical(result.body);
  if (canonical) {
    try {
      const canonicalUrl = new URL(canonical, normalizedUrl);
      if (canonicalUrl.hostname !== config.targetHost) {
        db.recordFailure({
          url: normalizedUrl,
          nowIso,
          status: result.status,
          error: `Canonical points to different host: ${canonicalUrl.hostname}`,
          lastmod,
        });
        return {
          url: normalizedUrl,
          outcome: "skipped",
          reason: "canonical-different-host",
        };
      }
    } catch {
      // Ignore invalid canonical href; fall through.
    }
  }

  const newHash = hashHtml(result.body);
  const existing = db.getByUrl(normalizedUrl);

  if (!existing) {
    db.upsertNew({
      url: normalizedUrl,
      nowIso,
      status: result.status,
      hash: newHash,
      lastmod,
    });
    return { url: normalizedUrl, outcome: "new" };
  }

  if (existing.last_hash !== newHash) {
    db.upsertChanged({
      url: normalizedUrl,
      nowIso,
      status: result.status,
      hash: newHash,
      lastmod,
    });
    return { url: normalizedUrl, outcome: "changed" };
  }

  db.upsertUnchanged({
    url: normalizedUrl,
    nowIso,
    status: result.status,
    lastmod,
  });
  return { url: normalizedUrl, outcome: "unchanged" };
}

function printSummary(
  config: AppConfig,
  counters: RunCounters,
  databasePath: string,
): void {
  const lines: string[] = [
    "",
    "Indexing run complete",
    "",
    `Target: ${config.targetSite}`,
    `Dry run: ${config.dryRun}`,
    "",
    `Sitemaps discovered: ${counters.sitemapsDiscovered}`,
    `URLs discovered: ${counters.urlsDiscovered}`,
    `URLs fetched: ${counters.fetched}`,
    `New URLs: ${counters.newCount}`,
    `Changed URLs: ${counters.changedCount}`,
    `Unchanged URLs: ${counters.unchangedCount}`,
    `Failed URLs: ${counters.failedCount}`,
    `Eligible for submission: ${counters.eligible}`,
    `Submitted to IndexNow: ${counters.submitted}`,
    `Skipped: ${counters.skipped}`,
    "",
    `Database: ${databasePath}`,
    "",
  ];
  for (const line of lines) console.log(line);
}

async function runOnce(): Promise<number> {
  const config = loadConfig();
  logger.info("Starting indexing run", {
    targetSite: config.targetSite,
    dryRun: config.dryRun,
    maxUrlsPerRun: config.maxUrlsPerRun,
    concurrency: config.concurrency,
  });

  const db = new IndexingDb(config.databasePath);
  const startedAt = new Date().toISOString();
  const runId = db.insertRun({
    startedAt,
    targetSite: config.targetSite,
    dryRun: config.dryRun,
  });

  const counters: RunCounters = {
    sitemapsDiscovered: 0,
    urlsDiscovered: 0,
    fetched: 0,
    newCount: 0,
    changedCount: 0,
    unchangedCount: 0,
    failedCount: 0,
    eligible: 0,
    submitted: 0,
    skipped: 0,
  };

  try {
    const robots = await fetchRobots(
      config.targetOrigin,
      config.userAgent,
      config.requestTimeoutMs,
    );
    logger.info(`robots.txt parsed: ${robots.sitemaps.length} Sitemap line(s) found`);

    const sitemapRoots =
      robots.sitemaps.length > 0
        ? robots.sitemaps.filter((s) => s.startsWith(config.targetOrigin))
        : [`${config.targetOrigin}/sitemap-index.xml`];

    if (sitemapRoots.length === 0) {
      sitemapRoots.push(`${config.targetOrigin}/sitemap-index.xml`);
    }

    const { sitemapUrls, entries } = await crawlSitemaps(
      sitemapRoots,
      config.targetOrigin,
      config.userAgent,
      config.requestTimeoutMs,
    );
    counters.sitemapsDiscovered = sitemapUrls.length;
    logger.info(
      `Sitemaps crawled: ${sitemapUrls.length}; raw URL entries: ${entries.length}`,
    );

    const seen = new Set<string>();
    const eligibleEntries: SitemapEntry[] = [];
    for (const entry of entries) {
      const normalized = normalizeUrl(entry.loc);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      if (!isEligiblePageUrl(normalized, config)) continue;
      const u = new URL(normalized);
      if (!isPathAllowed(robots, u.pathname)) continue;
      const next: SitemapEntry = { loc: normalized };
      if (entry.lastmod) next.lastmod = entry.lastmod;
      eligibleEntries.push(next);
    }
    counters.urlsDiscovered = eligibleEntries.length;

    if (eligibleEntries.length > config.maxUrlsPerRun) {
      logger.info(
        `Trimming eligible URLs to MAX_URLS_PER_RUN=${config.maxUrlsPerRun} (was ${eligibleEntries.length})`,
      );
    }
    const toProcess = eligibleEntries.slice(0, config.maxUrlsPerRun);

    const limit = createLimiter(config.concurrency);
    const submitCandidates: string[] = [];

    const results = await Promise.all(
      toProcess.map((entry) =>
        limit(async () => processUrl(entry, config, db)),
      ),
    );

    for (const res of results) {
      if (res.outcome === "skipped") {
        counters.skipped += 1;
        continue;
      }
      counters.fetched += 1;
      switch (res.outcome) {
        case "new":
          counters.newCount += 1;
          submitCandidates.push(res.url);
          break;
        case "changed":
          counters.changedCount += 1;
          submitCandidates.push(res.url);
          break;
        case "unchanged":
          counters.unchangedCount += 1;
          break;
        case "failed":
          counters.failedCount += 1;
          break;
      }
    }

    counters.eligible = submitCandidates.length;

    if (submitCandidates.length > 0) {
      const submitResult = await submitToIndexNow(submitCandidates, config);
      counters.submitted = submitResult.submitted;
      if (!config.dryRun && submitResult.submittedUrls.length > 0) {
        db.markSubmitted({
          urls: submitResult.submittedUrls,
          nowIso: new Date().toISOString(),
        });
      }
      if (submitResult.errors.length > 0) {
        logger.warn(`IndexNow submission errors: ${submitResult.errors.length}`);
      }
    }

    db.finalizeRun(runId, {
      finishedAt: new Date().toISOString(),
      discoveredCount: counters.urlsDiscovered,
      fetchedCount: counters.fetched,
      newCount: counters.newCount,
      changedCount: counters.changedCount,
      unchangedCount: counters.unchangedCount,
      submittedCount: counters.submitted,
      failedCount: counters.failedCount,
    });

    printSummary(config, counters, config.databasePath);
    return 0;
  } catch (err) {
    logger.error(`Run failed: ${(err as Error).message}`);
    db.finalizeRun(runId, {
      finishedAt: new Date().toISOString(),
      discoveredCount: counters.urlsDiscovered,
      fetchedCount: counters.fetched,
      newCount: counters.newCount,
      changedCount: counters.changedCount,
      unchangedCount: counters.unchangedCount,
      submittedCount: counters.submitted,
      failedCount: counters.failedCount,
    });
    return 1;
  } finally {
    db.close();
  }
}

void (async () => {
  const code = await runOnce();
  process.exitCode = code;
})();
