import { logger } from "./logger";
import { AppConfig } from "./types";
import { sleep } from "./limiter";

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEFAULT_BATCH_SIZE = 100;
const SUBMIT_RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;

export interface SubmitOptions {
  batchSize?: number;
}

export interface SubmitResult {
  attempted: number;
  submitted: number;
  batches: number;
  errors: string[];
  // URLs that belong to successfully-submitted batches, in submission order.
  // Use this (not a slice of the input list) when updating local state, so
  // failed intermediate batches don't cause the wrong URLs to be marked.
  submittedUrls: string[];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function submitToIndexNow(
  urls: string[],
  config: AppConfig,
  options: SubmitOptions = {},
): Promise<SubmitResult> {
  const batchSize = Math.min(options.batchSize ?? DEFAULT_BATCH_SIZE, 100);
  const filtered = urls.filter((u) => u.startsWith(`${config.targetOrigin}/`));
  if (filtered.length !== urls.length) {
    logger.warn(
      `submitToIndexNow filtered out ${urls.length - filtered.length} off-origin URL(s)`,
    );
  }

  const result: SubmitResult = {
    attempted: filtered.length,
    submitted: 0,
    batches: 0,
    errors: [],
    submittedUrls: [],
  };

  if (filtered.length === 0) return result;

  if (config.dryRun) {
    logger.info(
      `[DRY_RUN] Would submit ${filtered.length} URL(s) to IndexNow in ${
        chunk(filtered, batchSize).length
      } batch(es)`,
    );
    for (const u of filtered) {
      logger.info(`[DRY_RUN] candidate: ${u}`);
    }
    return result;
  }

  if (config.indexNowKey.length === 0) {
    throw new Error("INDEXNOW_KEY missing; refusing to submit in live mode");
  }

  for (const batch of chunk(filtered, batchSize)) {
    result.batches += 1;
    const body = {
      host: config.targetHost,
      key: config.indexNowKey,
      keyLocation: config.indexNowKeyLocation,
      urlList: batch,
    };

    let success = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        config.requestTimeoutMs,
      );
      try {
        const res = await fetch(INDEXNOW_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json; charset=utf-8",
            "user-agent": config.userAgent,
            accept: "application/json,*/*;q=0.1",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.ok || res.status === 202) {
          result.submitted += batch.length;
          for (const u of batch) result.submittedUrls.push(u);
          success = true;
          break;
        }
        if (SUBMIT_RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
          await sleep(750 * Math.pow(2, attempt));
          continue;
        }
        const errText = await safeReadText(res);
        result.errors.push(`HTTP ${res.status}: ${errText}`);
        break;
      } catch (err) {
        if (attempt < MAX_RETRIES) {
          await sleep(750 * Math.pow(2, attempt));
          continue;
        }
        result.errors.push((err as Error).message);
      } finally {
        clearTimeout(timer);
      }
    }
    if (!success && result.errors.length > 0) {
      logger.warn(`IndexNow batch failed: ${result.errors[result.errors.length - 1]}`);
    }
  }

  return result;
}

async function safeReadText(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 400);
  } catch {
    return "";
  }
}
