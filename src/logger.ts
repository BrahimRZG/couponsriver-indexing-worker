const REDACT_KEYS = [
  "INDEXNOW_KEY",
  "BING_WEBMASTER_API_KEY",
  "GOOGLE_PRIVATE_KEY",
];

/**
 * Optional environment snapshot used by the worker path to redact secrets.
 * In CLI mode this is populated automatically from process.env at redaction
 * time; in Worker mode call logger.setEnv(env) before each run.
 */
const envSnapshot: Record<string, string> = {};

/** Safely read a key from process.env without referencing `process` at the
 *  type level — this allows the file to compile under @cloudflare/workers-types
 *  (which does not expose `process`) as well as under @types/node. */
function readProcessEnv(key: string): string | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proc = (typeof globalThis !== "undefined" && (globalThis as any)["process"]) as
    | { env?: Record<string, string | undefined> }
    | undefined;
  return proc?.env?.[key];
}

function redact(input: unknown): unknown {
  if (typeof input === "string") {
    let out = input;
    for (const key of REDACT_KEYS) {
      const value = readProcessEnv(key) ?? envSnapshot[key];
      if (value && value.length > 3) {
        out = out.split(value).join(`[redacted:${key}]`);
      }
    }
    return out;
  }
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (REDACT_KEYS.includes(k)) {
        out[k] = "[redacted]";
      } else {
        out[k] = redact(v);
      }
    }
    return out;
  }
  return input;
}

function format(level: string, message: string, meta?: unknown): string {
  const ts = new Date().toISOString();
  if (meta === undefined) {
    return `[${ts}] ${level} ${message}`;
  }
  const safe = redact(meta);
  return `[${ts}] ${level} ${message} ${JSON.stringify(safe)}`;
}

function isDebugEnabled(): boolean {
  const fromProcess = readProcessEnv("DEBUG");
  if (fromProcess) return true;
  return envSnapshot["DEBUG"] === "true" || envSnapshot["DEBUG"] === "1";
}

export const logger = {
  /**
   * Call this in Worker mode before each run to allow secret redaction.
   * Pass an object with INDEXNOW_KEY (and any other secrets) so the logger
   * can strip them from log output without relying on process.env.
   */
  setEnv(env: Record<string, string>): void {
    for (const key of REDACT_KEYS) {
      if (env[key]) envSnapshot[key] = env[key];
    }
    if (env["DEBUG"]) envSnapshot["DEBUG"] = env["DEBUG"];
  },

  info(message: string, meta?: unknown): void {
    console.log(format("INFO ", message, meta));
  },
  warn(message: string, meta?: unknown): void {
    console.warn(format("WARN ", message, meta));
  },
  error(message: string, meta?: unknown): void {
    console.error(format("ERROR", message, meta));
  },
  debug(message: string, meta?: unknown): void {
    if (isDebugEnabled()) {
      console.log(format("DEBUG", message, meta));
    }
  },
};
