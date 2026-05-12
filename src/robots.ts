import { logger } from "./logger";

export interface RobotsInfo {
  sitemaps: string[];
  disallowed: string[];
  raw: string;
}

export async function fetchRobots(
  targetOrigin: string,
  userAgent: string,
  timeoutMs: number,
): Promise<RobotsInfo> {
  const url = `${targetOrigin.replace(/\/$/, "")}/robots.txt`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "text/plain,*/*;q=0.1" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      logger.warn(`robots.txt returned HTTP ${res.status}; continuing with sitemap-index fallback`);
      return { sitemaps: [], disallowed: [], raw: "" };
    }
    const text = await res.text();
    return parseRobots(text);
  } finally {
    clearTimeout(timer);
  }
}

export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const disallowed: string[] = [];
  let inGlobalUserAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "sitemap" && value.length > 0) {
      sitemaps.push(value);
    } else if (key === "user-agent") {
      inGlobalUserAgent = value === "*";
    } else if (key === "disallow" && inGlobalUserAgent && value.length > 0) {
      disallowed.push(value);
    }
  }
  return { sitemaps, disallowed, raw: text };
}

export function isPathAllowed(robots: RobotsInfo, urlPath: string): boolean {
  if (robots.disallowed.length === 0) return true;
  for (const rule of robots.disallowed) {
    if (rule === "/") return false;
    if (urlPath.startsWith(rule)) return false;
  }
  return true;
}
