// URL normalization + SSRF guard. Centralized here so every capture entry point
// (iOS Shortcut, Chrome extension, bootstrap script) dedupes identically — the
// normalized URL is the dedupe key (captures.normalized_url UNIQUE).

/** Thrown when a string cannot be parsed as a URL. Callers map this to a 400. */
export class InvalidUrlError extends Error {
  constructor(raw: string) {
    super(`Not a valid URL: ${raw}`);
    this.name = "InvalidUrlError";
  }
}

// Tracking / share-attribution params that never identify the resource itself.
// utm_* is matched by prefix; the rest are matched exactly.
const TRACKING_PREFIXES = ["utm_"];
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "igsh",
  "ref",
  "ref_src",
  "ref_url",
  "s", // twitter share token (?s=20)
  "cmpid",
  "spm",
]);

function isTrackingParam(key: string): boolean {
  const k = key.toLowerCase();
  if (TRACKING_PREFIXES.some((p) => k.startsWith(p))) return true;
  return TRACKING_PARAMS.has(k);
}

/**
 * Produce the canonical dedupe key for a URL. Deterministic and synchronous —
 * no network resolution (t.co/shortener expansion is deferred; the risk is
 * duplicate items, not correctness — see plan risk table).
 *
 * Rules: lowercase host, drop default port, strip tracking params, sort the
 * remaining params for order-independence, drop the fragment, trim a trailing
 * slash from non-root paths.
 */
export function normalizeUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new InvalidUrlError(raw);
  }

  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  // Never carry credentials into the dedupe key or persisted row.
  u.username = "";
  u.password = "";

  // Drop default ports so :443/:80 don't fork the key.
  if (
    (u.protocol === "https:" && u.port === "443") ||
    (u.protocol === "http:" && u.port === "80")
  ) {
    u.port = "";
  }

  // Strip tracking params, then sort the survivors for a stable key.
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingParam(key)) u.searchParams.delete(key);
  }
  u.searchParams.sort();

  // Trim a single trailing slash from non-root paths ("/a/" -> "/a", "/" kept).
  if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
    u.pathname = u.pathname.replace(/\/+$/, "");
  }

  // URL serialization leaves a "?" if all params were stripped; remove it.
  let out = u.toString();
  if (out.endsWith("?")) out = out.slice(0, -1);
  return out;
}

// Literal-IP SSRF ranges. Hostnames that resolve to these via DNS are NOT
// caught here (that needs async resolution); full hop-by-hop revalidation lands
// in U4 where the URL is actually fetched. This synchronous guard rejects the
// obvious cases at capture time.
const PRIVATE_HOSTNAMES = new Set(["localhost", "ip6-localhost", "ip6-loopback"]);

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a > 255 || b > 255 || Number(m[3]) > 255 || Number(m[4]) > 255) return true; // malformed → reject
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  return false;
}

// Pull a dotted-IPv4 out of an IPv6 literal that embeds one — either the
// dotted tail the parser sometimes keeps (`::ffff:127.0.0.1`) or, more often,
// the canonical hex form it produces (`::ffff:7f00:1`). Used for IPv4-mapped
// (::ffff:0:0/96) and NAT64 (64:ff9b::/96) addresses, which would otherwise
// route past the IPv4 private-range check entirely.
function embeddedIpv4(h: string): string | null {
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (dotted) return dotted[1]!;
  const hex = /:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function isPrivateIpv6(host: string): boolean {
  // URL hostnames keep IPv6 in brackets; strip them.
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "::1" || h === "::") return true; // loopback / unspecified
  if (h.startsWith("fe80")) return true; // link-local
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique-local fc00::/7
  // IPv4-mapped / NAT64: check the embedded IPv4 against the private ranges so
  // ::ffff:127.0.0.1 and ::ffff:169.254.169.254 can't slip through.
  if (h.startsWith("::ffff:") || h.startsWith("64:ff9b:")) {
    const v4 = embeddedIpv4(h);
    if (v4 && isPrivateIpv4(v4)) return true;
  }
  return false;
}

export interface FetchTargetResult {
  ok: boolean;
  reason?: string;
}

/**
 * Guard a user-supplied URL before RWL (or anything downstream) fetches it.
 * Rejects non-http(s) schemes and literal private/loopback/link-local hosts.
 * Used by the capture route as input validation, and reused by U4's og: fetch.
 */
export function validateFetchTarget(raw: string): FetchTargetResult {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "unparseable URL" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, reason: `disallowed scheme: ${u.protocol}` };
  }
  const host = u.hostname.toLowerCase();
  if (PRIVATE_HOSTNAMES.has(host)) {
    return { ok: false, reason: "loopback host" };
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(u.hostname)) {
    return { ok: false, reason: "private or loopback address" };
  }
  return { ok: true };
}
