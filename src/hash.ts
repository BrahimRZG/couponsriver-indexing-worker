// Patterns whose contents change on every response but do NOT reflect a real
// content change. These are stripped (or substituted with a constant) before
// hashing so that unchanged pages produce the same SHA-256 across runs.
const VOLATILE_REPLACEMENTS: Array<[RegExp, string]> = [
  // Manual build markers (some sites include these).
  [/<!--\s*build\s*timestamp[^>]*-->/gi, ""],
  [/<meta[^>]+name=["']?build-time["']?[^>]*>/gi, ""],
  [/<script[^>]*data-build[^>]*>[^<]*<\/script>/gi, ""],
  // Cloudflare challenge/analytics params (request id + timestamp).
  // Example: window.__CF$cv$params={r:'...',t:'...'};
  [/window\.__CF\$cv\$params\s*=\s*\{[^}]*\}\s*;?/g, "window.__CF$cv$params={};"],
  // Cloudflare email obfuscation: per-response XOR-encrypted tokens.
  [/data-cfemail=["'][0-9a-f]+["']/gi, 'data-cfemail=""'],
  [/cfemail=["'][0-9a-f]+["']/gi, 'cfemail=""'],
  // The email-protection href fragment rotates with the token.
  [/(\/cdn-cgi\/l\/email-protection)#[0-9a-f]+/gi, "$1"],
  // CSP/script nonces (if any).
  [/\snonce=["'][^"']+["']/gi, ""],
];

// Strip any <script>...</script> block whose content or src references
// Cloudflare's edge tooling. Cloudflare re-orders and re-parameterizes these
// between responses (beacon token rotation, insights ordering, challenge
// platform bootstrap), so excluding them prevents false "changed" results
// without losing real content signal.
const CF_SCRIPT_PATTERNS: Array<RegExp> = [
  /<script\b[^>]*\bsrc=["'][^"']*cloudflareinsights[^"']*["'][^>]*>(?:(?!<\/script>)[\s\S])*<\/script>/gi,
  /<script\b[^>]*>(?:(?!<\/script>)[\s\S])*?(?:__CF\$cv\$params|cdn-cgi\/challenge-platform|cloudflareinsights)(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
];

export function normalizeHtmlForHash(html: string): string {
  let out = html;
  for (const pattern of CF_SCRIPT_PATTERNS) {
    out = out.replace(pattern, "");
  }
  for (const [pattern, replacement] of VOLATILE_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/\r\n/g, "\n");
  out = out.replace(/[\t ]+\n/g, "\n");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * SHA-256 hash using the Web Crypto API (SubtleCrypto).
 * Works in both Node 20 (globalThis.crypto) and Cloudflare Workers.
 *
 * We access crypto via `(globalThis as unknown as { crypto: Crypto }).crypto`
 * so this compiles cleanly under both the Node (@types/node) and
 * Cloudflare Workers (@cloudflare/workers-types) TypeScript configs, which
 * have slightly different globalThis augmentations.
 */
export async function sha256(input: string): Promise<string> {
  const subtle = (
    globalThis as unknown as {
      crypto: {
        subtle: {
          digest(
            algorithm: string,
            data: ArrayBufferView | ArrayBuffer,
          ): Promise<ArrayBuffer>;
        };
      };
    }
  ).crypto.subtle;
  const encoded = new TextEncoder().encode(input);
  const buffer = await subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hashHtml(html: string): Promise<string> {
  return sha256(normalizeHtmlForHash(html));
}
