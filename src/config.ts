import "dotenv/config";
import path from "node:path";
import { AppConfig } from "./types";

function readString(name: string, fallback?: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return raw;
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  // Reject anything that isn't a pure positive integer. parseInt is too
  // lenient (it accepts "15ms" as 15, "15foo" as 15, etc.) and silently
  // dropping trailing garbage hides typos.
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`Invalid boolean for ${name}: ${raw}`);
}

export function loadConfig(): AppConfig {
  const targetSite = readString("TARGET_SITE", "https://couponsriver.com");
  let targetUrl: URL;
  try {
    targetUrl = new URL(targetSite);
  } catch {
    throw new Error(`TARGET_SITE is not a valid URL: ${targetSite}`);
  }
  if (targetUrl.protocol !== "https:") {
    throw new Error(`TARGET_SITE must use HTTPS (got ${targetUrl.protocol})`);
  }

  const databasePathRaw = readString("DATABASE_PATH", "./data/indexing.sqlite");
  const databasePath = path.isAbsolute(databasePathRaw)
    ? databasePathRaw
    : path.resolve(process.cwd(), databasePathRaw);

  const dryRun = readBool("DRY_RUN", true);
  // Whitespace-only keys would slip past `length === 0` but are useless
  // (and the IndexNow endpoint would reject them anyway), so trim first.
  const indexNowKey = (process.env.INDEXNOW_KEY ?? "").trim();
  if (!dryRun && indexNowKey.length === 0) {
    throw new Error(
      "INDEXNOW_KEY is required when DRY_RUN=false. Set DRY_RUN=true or provide a key.",
    );
  }

  const config: AppConfig = {
    targetSite: targetUrl.toString().replace(/\/$/, ""),
    targetOrigin: targetUrl.origin,
    targetHost: targetUrl.hostname,
    indexNowKey,
    indexNowKeyLocation: readString(
      "INDEXNOW_KEY_LOCATION",
      `${targetUrl.origin}/indexnow-key.txt`,
    ),
    maxUrlsPerRun: readInt("MAX_URLS_PER_RUN", 500),
    concurrency: readInt("CONCURRENCY", 5),
    requestTimeoutMs: readInt("REQUEST_TIMEOUT_MS", 15000),
    userAgent: readString(
      "USER_AGENT",
      "CouponsRiverIndexingWorker/1.0 (+https://couponsriver.com)",
    ),
    databasePath,
    dryRun,
    bingWebmasterApiKey: process.env.BING_WEBMASTER_API_KEY ?? "",
  };

  if (config.maxUrlsPerRun > 500) {
    throw new Error(
      `MAX_URLS_PER_RUN must be <= 500 (stop condition). Got ${config.maxUrlsPerRun}.`,
    );
  }
  if (config.concurrency > 16) {
    throw new Error(`CONCURRENCY must be <= 16. Got ${config.concurrency}.`);
  }

  return config;
}
