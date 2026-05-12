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
  } catch (err) {
    // Transient network failures fetching robots.txt should not abort
    // the entire run; fall back to discovering sitemaps from
    // /sitemap-index.xml. We log the error so it's still visible.
    logger.warn(
      `Failed to fetch robots.txt at ${url}: ${(err as Error).message}; ` +
        `continuing with sitemap-index fallback`,
    );
    return { sitemaps: [], disallowed: [], raw: "" };
  } finally {
    clearTimeout(timer);
  }
}

export function parseRobots(text: string): RobotsInfo {
  const sitemaps: string[] = [];
  const disallowed: string[] = [];

  // robots.txt groups multiple consecutive User-agent lines together;
  // rules apply to every UA declared at the top of the group. We must
  // remember whether "*" appeared anywhere in the current group, not
  // just the most recent User-agent line.
  let currentGroupAgents = new Set<string>();
  let sawRuleInGroup = false;

  const isGlobalGroup = (): boolean => currentGroupAgents.has("*");

  const startNewGroup = (): void => {
    currentGroupAgents = new Set<string>();
    sawRuleInGroup = false;
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (line.length === 0) {
      // Blank line ends the current group.
      startNewGroup();
      continue;
    }
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "sitemap" && value.length > 0) {
      sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      // A User-agent line that appears AFTER a rule in this group
      // starts a new group (per RFC 9309).
      if (sawRuleInGroup) startNewGroup();
      currentGroupAgents.add(value);
      continue;
    }
    if (key === "disallow" || key === "allow") {
      sawRuleInGroup = true;
      if (key === "disallow" && isGlobalGroup() && value.length > 0) {
        disallowed.push(value);
      }
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
