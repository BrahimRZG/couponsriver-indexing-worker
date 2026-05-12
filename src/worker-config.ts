/**
 * Config loader for the Cloudflare Worker runtime.
 *
 * Unlike src/config.ts (which reads process.env via dotenv), this module
 * reads from the Cloudflare Workers env bindings object passed to every
 * handler. No Node.js APIs (path, fs, dotenv) are used here.
 */

import { AppConfig } from "./types";

/** The shape of the Cloudflare Workers environment bindings. */
export interface WorkerEnv {
  /** D1 database binding — must be named DB in wrangler.toml. */
  DB: import("@cloudflare/workers-types").D1Database;

  /** Plain-text env vars (set in [vars] in wrangler.toml). */
  TARGET_SITE: string;
  INDEXNOW_KEY_LOCATION: string;
  DRY_RUN: string;
  MAX_URLS_PER_RUN: string;
  CONCURRENCY: string;
  REQUEST_TIMEOUT_MS: string;
  USER_AGENT?: string;

  /** Secret — set via `wrangler secret put INDEXNOW_KEY`. Never in wrangler.toml. */
  INDEXNOW_KEY: string;
}

function readString(env: WorkerEnv, name: keyof WorkerEnv, fallback?: string): string {
  const raw = env[name] as string | undefined;
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required Worker binding/var: ${name}`);
  }
  return raw;
}

function readInt(env: WorkerEnv, name: keyof WorkerEnv, fallback: number): number {
  const raw = env[name] as string | undefined;
  if (raw === undefined || raw === "") return fallback;
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer for ${name}: ${raw}`);
  }
  return n;
}

function readBool(env: WorkerEnv, name: keyof WorkerEnv, fallback: boolean): boolean {
  const raw = env[name] as string | undefined;
  if (raw === undefined || raw === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`Invalid boolean for ${name}: ${raw}`);
}

export function loadWorkerConfig(env: WorkerEnv): AppConfig {
  const targetSite = readString(env, "TARGET_SITE", "https://couponsriver.com");
  let targetUrl: URL;
  try {
    targetUrl = new URL(targetSite);
  } catch {
    throw new Error(`TARGET_SITE is not a valid URL: ${targetSite}`);
  }
  if (targetUrl.protocol !== "https:") {
    throw new Error(`TARGET_SITE must use HTTPS (got ${targetUrl.protocol})`);
  }

  const dryRun = readBool(env, "DRY_RUN", true);
  const indexNowKey = ((env.INDEXNOW_KEY as string | undefined) ?? "").trim();
  if (!dryRun && indexNowKey.length === 0) {
    throw new Error(
      "INDEXNOW_KEY secret is required when DRY_RUN=false. " +
        "Run: wrangler secret put INDEXNOW_KEY",
    );
  }

  const maxUrlsPerRun = readInt(env, "MAX_URLS_PER_RUN", 25);
  if (maxUrlsPerRun > 500) {
    throw new Error(
      `MAX_URLS_PER_RUN must be <= 500 (stop condition). Got ${maxUrlsPerRun}.`,
    );
  }

  const concurrency = readInt(env, "CONCURRENCY", 2);
  if (concurrency > 16) {
    throw new Error(`CONCURRENCY must be <= 16. Got ${concurrency}.`);
  }

  return {
    targetSite: targetUrl.toString().replace(/\/$/, ""),
    targetOrigin: targetUrl.origin,
    targetHost: targetUrl.hostname,
    indexNowKey,
    indexNowKeyLocation: readString(
      env,
      "INDEXNOW_KEY_LOCATION",
      `${targetUrl.origin}/indexnow-key.txt`,
    ),
    maxUrlsPerRun,
    concurrency,
    requestTimeoutMs: readInt(env, "REQUEST_TIMEOUT_MS", 15000),
    userAgent:
      (env.USER_AGENT ?? "") ||
      "CouponsRiverIndexingWorker/1.0 (+https://couponsriver.com)",
    // databasePath is intentionally absent — Worker mode uses D1.
    dryRun,
    bingWebmasterApiKey: "",
  };
}
