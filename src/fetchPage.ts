import { FetchResult } from "./types";
import { sleep } from "./limiter";

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 2;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

export interface FetchPageOptions {
  userAgent: string;
  timeoutMs: number;
  targetOrigin: string;
}

export async function fetchPage(
  url: string,
  options: FetchPageOptions,
): Promise<FetchResult> {
  let lastError: string | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await fetch(url, {
        headers: {
          "user-agent": options.userAgent,
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "en-US,en;q=0.9",
        },
        signal: controller.signal,
        redirect: "follow",
      });
      const finalUrl = res.url || url;
      const contentType = res.headers.get("content-type") ?? undefined;

      if (RETRY_STATUSES.has(res.status) && attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }

      if (!res.ok) {
        return {
          url,
          finalUrl,
          status: res.status,
          contentType,
          body: undefined,
          ok: false,
          error: `HTTP ${res.status}`,
        };
      }

      if (!finalUrl.startsWith(options.targetOrigin)) {
        return {
          url,
          finalUrl,
          status: res.status,
          contentType,
          body: undefined,
          ok: false,
          error: `Redirected off target origin: ${finalUrl}`,
        };
      }

      if (!contentType || !contentType.toLowerCase().includes("text/html")) {
        return {
          url,
          finalUrl,
          status: res.status,
          contentType,
          body: undefined,
          ok: false,
          error: `Non-HTML content-type: ${contentType ?? "(none)"}`,
        };
      }

      const body = await readBodyLimited(res);
      return {
        url,
        finalUrl,
        status: res.status,
        contentType,
        body,
        ok: true,
      };
    } catch (err) {
      lastError = (err as Error).message || "fetch error";
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      return {
        url,
        finalUrl: url,
        status: 0,
        contentType: undefined,
        body: undefined,
        ok: false,
        error: lastError,
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    url,
    finalUrl: url,
    status: 0,
    contentType: undefined,
    body: undefined,
    ok: false,
    error: lastError ?? "unknown error",
  };
}

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}

async function readBodyLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return await res.text();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      out += decoder.decode(value, { stream: true });
      // Release the underlying HTTP connection — without cancel() the
      // stream keeps buffering until the response is fully drained.
      try {
        await reader.cancel();
      } catch {
        // ignore cancel errors; we already have the bytes we need
      }
      break;
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

// <link> attribute order isn't fixed in HTML, so we look at every <link> tag
// in <head>, then pick the first one whose rel attribute equals "canonical"
// (case-insensitive, possibly inside a space-separated list).
const LINK_TAG_RE = /<link\b[^>]*>/gi;
const HREF_ATTR_RE = /\bhref\s*=\s*(["'])([^"']+)\1/i;
const REL_ATTR_RE = /\brel\s*=\s*(["']?)([^"'>\s]+(?:\s+[^"'>\s]+)*)\1/i;

export function extractCanonical(html: string): string | undefined {
  let match: RegExpExecArray | null;
  LINK_TAG_RE.lastIndex = 0;
  while ((match = LINK_TAG_RE.exec(html)) !== null) {
    const tag = match[0];
    const relMatch = REL_ATTR_RE.exec(tag);
    if (!relMatch) continue;
    const relValue = relMatch[2] ?? "";
    const rels = relValue.toLowerCase().split(/\s+/);
    if (!rels.includes("canonical")) continue;
    const hrefMatch = HREF_ATTR_RE.exec(tag);
    const href = hrefMatch?.[2]?.trim();
    if (href && href.length > 0) return href;
  }
  return undefined;
}
