import { XMLParser } from "fast-xml-parser";
import { SitemapEntry } from "./types";
import { logger } from "./logger";

const MAX_SITEMAP_DEPTH = 5;

const parser = new XMLParser({
  ignoreAttributes: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
  isArray: (name) => name === "sitemap" || name === "url",
});

async function fetchText(
  url: string,
  userAgent: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "application/xml,text/xml,*/*;q=0.1" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch sitemap ${url}: HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export interface CrawlSitemapsResult {
  sitemapUrls: string[];
  entries: SitemapEntry[];
}

export async function crawlSitemaps(
  rootSitemaps: string[],
  targetOrigin: string,
  userAgent: string,
  timeoutMs: number,
): Promise<CrawlSitemapsResult> {
  const visited = new Set<string>();
  const sitemapUrls: string[] = [];
  const entries: SitemapEntry[] = [];

  async function visit(url: string, depth: number): Promise<void> {
    if (depth > MAX_SITEMAP_DEPTH) {
      logger.warn(`Sitemap depth limit reached for ${url}`);
      return;
    }
    if (visited.has(url)) return;
    visited.add(url);

    if (!url.startsWith(targetOrigin)) {
      logger.warn(`Skipping sitemap outside target origin: ${url}`);
      return;
    }

    sitemapUrls.push(url);
    let xml: string;
    try {
      xml = await fetchText(url, userAgent, timeoutMs);
    } catch (err) {
      logger.warn(`Failed to fetch sitemap ${url}: ${(err as Error).message}`);
      return;
    }

    let parsed: unknown;
    try {
      parsed = parser.parse(xml) as unknown;
    } catch (err) {
      logger.warn(`Failed to parse sitemap XML at ${url}: ${(err as Error).message}`);
      return;
    }

    const root = parsed as Record<string, unknown> | undefined;
    if (!root) return;

    if (root["sitemapindex"]) {
      const index = root["sitemapindex"] as { sitemap?: Array<{ loc?: string }> };
      const items = asArray(index.sitemap);
      for (const item of items) {
        const loc = item?.loc?.trim();
        if (loc) await visit(loc, depth + 1);
      }
      return;
    }

    if (root["urlset"]) {
      const urlset = root["urlset"] as { url?: Array<{ loc?: string; lastmod?: string }> };
      const items = asArray(urlset.url);
      for (const item of items) {
        const loc = item?.loc?.trim();
        if (!loc) continue;
        const entry: SitemapEntry = { loc };
        if (item.lastmod) entry.lastmod = item.lastmod.trim();
        entries.push(entry);
      }
      return;
    }

    logger.warn(`Sitemap at ${url} has no <sitemapindex> or <urlset>; skipping`);
  }

  for (const root of rootSitemaps) {
    await visit(root, 0);
  }

  return { sitemapUrls, entries };
}
