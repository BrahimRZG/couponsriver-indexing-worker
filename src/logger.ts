const REDACT_KEYS = [
  "INDEXNOW_KEY",
  "BING_WEBMASTER_API_KEY",
  "GOOGLE_PRIVATE_KEY",
];

function redact(input: unknown): unknown {
  if (typeof input === "string") {
    let out = input;
    for (const key of REDACT_KEYS) {
      const value = process.env[key];
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

export const logger = {
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
    if (process.env.DEBUG) {
      console.log(format("DEBUG", message, meta));
    }
  },
};
