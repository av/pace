import { warnUrlParseFailure } from "./utils-warn";

function hasStringMessage(err: unknown): err is { message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof (err as Record<string, unknown>).message === "string"
  );
}

/** True for the abort error produced by AbortSignal.timeout(). */
export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "TimeoutError" ||
      (err.name === "AbortError" && /time/i.test(err.message)))
  );
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (hasStringMessage(err)) return err.message;
  return String(err);
}

/** Parse URL; warn and return null on failure. Shared by dedupe + layout (replaces duplicate try/catch). */
export function tryParseUrl(
  url: string,
  warnContext: string,
  purpose: string,
): URL | null {
  if (!url) return null;
  try {
    return new URL(url);
  } catch (err) {
    warnUrlParseFailure(warnContext, purpose, url, errorMessage(err));
    return null;
  }
}

const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Original URL when parse succeeds and protocol is safe for dashboard links; else null. */
export function safeLinkUrl(url: string, warnContext = "layout"): string | null {
  const parsed = tryParseUrl(url, warnContext, "dashboard link");
  if (!parsed) return null;
  if (parsed.username || parsed.password) return null;
  return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? url : null;
}

const SENSITIVE_QUERY_KEY_PART = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth(?:orization)?|auth[_-]?token|bearer[_-]?token|client[_-]?secret|credential|key|passw(?:or)?d|secret|sig(?:nature)?|token)(?:$|[_-])/i;
const SENSITIVE_QUERY_KEYS_COMPACT = new Set([
  "apikey",
  "accesstoken",
  "authorization",
  "authtoken",
  "bearertoken",
  "clientsecret",
  "credential",
  "key",
  "password",
  "passwd",
  "secret",
  "signature",
  "sig",
  "token",
  "xamzcredential",
  "xamzsecuritytoken",
  "xamzsignature",
]);

/** Redact basic-auth userinfo and credential-like query/fragment values in diagnostic URLs. */
export function redactSensitiveUrlCredentials(text: string): string {
  const withoutUserinfo = text.replace(
    /\b(https?:\/\/)[^/?#\s@]+@/gi,
    "$1[REDACTED]@",
  );
  return withoutUserinfo.replace(
    /([?&#])([^&#=\s]+)=([^&#\s]*)/g,
    (match, separator: string, rawKey: string) => {
      let key = rawKey;
      try {
        key = decodeURIComponent(rawKey);
      } catch {
        // Keep malformed keys diagnosable; the raw-key checks below still apply.
      }
      const compact = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (
        !SENSITIVE_QUERY_KEY_PART.test(key)
        && !SENSITIVE_QUERY_KEYS_COMPACT.has(compact)
      ) {
        return match;
      }
      return `${separator}${rawKey}=[REDACTED]`;
    },
  );
}

/** Lowercase hostname with leading `www.` removed. */
export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

export function parsePort(input: string | undefined, fallback = 7453): number {
  if (input === undefined || input === "") return fallback;
  return parseCliPort(input) ?? fallback;
}

export function isValidPort(n: number): boolean {
  return !isNaN(n) && n >= 1 && n <= 65535;
}

/** Parse a CLI `--port` value; rejects partial integers like `8080x` (unlike `parseInt`). */
export function parseCliPort(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return isValidPort(n) ? n : null;
}

export function getAdapterName(cfg: { name?: string; type: string }): string {
  return cfg.name ?? cfg.type;
}

/**
 * Compare ISO-8601 timestamp strings for `Array.sort`.
 * Ties return 0; with stable sort, equal timestamps keep their prior order
 * (e.g. source concat order in `runPipelineJob`, or input order in transforms).
 */
export function compareIsoTimestamp(
  a: string,
  b: string,
  direction: "asc" | "desc" = "desc",
): number {
  const descCmp = b > a ? 1 : b < a ? -1 : 0;
  if (descCmp === 0) return 0;
  return direction === "asc" ? -descCmp : descCmp;
}

/**
 * Future timestamps within this window pass through unclamped, so legitimate
 * marginal clock skew between the feed's server and ours isn't visibly
 * re-stamped to the fetch time.
 */
export const FUTURE_TIMESTAMP_TOLERANCE_MS = 5 * 60_000;

/**
 * Clamp a future-dated ISO timestamp to `now`.
 *
 * Feeds with skewed clocks (or bogus scheduled-post dates) otherwise
 * sort-pin their items to the top of every panel and pipeline input until
 * the date ages in — `compareIsoTimestamp` desc puts them first
 * indefinitely, and they render as "just now" forever. Unparseable
 * timestamps pass through unchanged (callers already tolerate them).
 */
export function clampFutureTimestamp(timestamp: string, now = Date.now()): string {
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return timestamp;
  if (then <= now + FUTURE_TIMESTAMP_TOLERANCE_MS) return timestamp;
  return new Date(now).toISOString();
}

/** Human-readable relative age for dashboard timestamps (minutes/hours/days ago). */
export function relativeTime(timestamp: string, now = Date.now()): string {
  const then = new Date(timestamp).getTime();
  if (isNaN(then)) return "";
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Stable compact UTC timestamp for static snapshots that may be viewed later. */
export function absoluteUtcTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

/** Return at most `limit` items from the start of the array. */
export function sliceToLimit<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

/**
 * Parse a JSON-encoded string[] column (e.g. content_items.origins). Null,
 * malformed JSON, non-array documents, and non-string entries all degrade to
 * the empty array / are dropped — the columns are best-effort provenance.
 */
export function parseJsonStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

/** Trim each string and drop empty entries (after trim). */
export function normalizeStringList(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean);
}

/** Read string-list adapter param, trim entries, drop blanks. Missing/non-array → []. */
export function normalizeParamStringList(
  params: Record<string, unknown> | undefined,
  key: string,
): string[] {
  const raw = params?.[key];
  if (!Array.isArray(raw)) return [];
  return normalizeStringList(raw as string[]);
}

/** Read optional string adapter param; trim; missing/non-string/blank → fallback (or undefined). */
export function normalizeParamString(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback: string,
): string;
export function normalizeParamString(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback?: string,
): string | undefined;
export function normalizeParamString(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback?: string,
): string | undefined {
  const raw = params?.[key];
  if (typeof raw !== "string") return fallback;
  return normalizeOptionalString(raw) ?? fallback;
}

/**
 * Read the first present param key (in order); trim string value.
 * A present but blank/non-string value uses fallback without trying later keys.
 */
export function normalizeParamStringFirst(
  params: Record<string, unknown> | undefined,
  keys: readonly string[],
  fallback: string,
): string;
export function normalizeParamStringFirst(
  params: Record<string, unknown> | undefined,
  keys: readonly string[],
  fallback?: string,
): string | undefined;
export function normalizeParamStringFirst(
  params: Record<string, unknown> | undefined,
  keys: readonly string[],
  fallback?: string,
): string | undefined {
  for (const key of keys) {
    const value = params?.[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") return fallback;
    return normalizeOptionalString(value) ?? fallback;
  }
  return fallback;
}

/** Read optional boolean adapter param; missing/non-boolean → fallback (default false). */
export function normalizeParamBoolean(
  params: Record<string, unknown> | undefined,
  key: string,
  fallback = false,
): boolean {
  const raw = params?.[key];
  if (typeof raw !== "boolean") return fallback;
  return raw;
}

/** Trim optional string; return undefined if missing or blank after trim. */
export function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  const trimmed = (value ?? "").trim();
  return trimmed || undefined;
}

/** Coerce optional param to a finite non-negative number; invalid values → fallback (default 0). */
export function normalizeNonNegativeNumber(
  value: unknown,
  fallback = 0,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }
  return value;
}

/** Coerce optional param to a positive integer; invalid values → fallback (default 1). */
export function normalizePositiveInteger(
  value: unknown,
  fallback = 1,
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}

/** Adapter `params.limit`: positive integer with default, capped at API max. */
export function clampAdapterLimit(
  value: unknown,
  fallback: number,
  cap: number,
): number {
  return Math.min(normalizePositiveInteger(value, fallback), cap);
}

/** Promise-based delay for adapter rate limiting and pacing. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Canonical option tokens keyed by lowercase form (identity map for string enums). */
export function canonicalOptionTypes<T extends string>(
  ...values: readonly T[]
): Record<string, T> {
  const types: Record<string, T> = {};
  for (const value of values) {
    types[value.toLowerCase()] = value;
  }
  return types;
}

export type AliasedOptionTypes<T> = readonly T[] | Record<string, T>;

function buildOptionTypesMap<T>(types: AliasedOptionTypes<T>): Record<string, T> {
  if (Array.isArray(types)) {
    return canonicalOptionTypes(...types);
  }
  // Array.isArray doesn't narrow `readonly T[]` out of the union in TS 6.x
  return types as Record<string, T>;
}

type AliasedResolverConfig<T> = {
  types: AliasedOptionTypes<T>;
  aliases?: Record<string, T>;
  fallback: T;
};

type NullableAliasedResolverConfig<T> = {
  types: AliasedOptionTypes<T>;
  aliases?: Record<string, T>;
  fallback: null;
};

/** Factory for adapter sort/feed/period resolvers backed by resolveAliasedOption. */
export function createAliasedResolver<T>(
  config: AliasedResolverConfig<T>,
): (input: string) => T;
export function createAliasedResolver<T>(
  config: NullableAliasedResolverConfig<T>,
): (input: string) => T | null;
export function createAliasedResolver<T>(
  config: AliasedResolverConfig<T> | NullableAliasedResolverConfig<T>,
): (input: string) => T | null {
  const types = buildOptionTypesMap(config.types);
  const aliases = config.aliases ?? {};
  const { fallback } = config;
  return (input: string) => resolveAliasedOption(input, types, aliases, fallback);
}

/** Map a configured token to a canonical value via lowercase lookup in types then aliases. */
export function resolveAliasedOption<T>(
  input: string,
  types: Record<string, T>,
  aliases: Record<string, T>,
  fallback: T,
): T;
export function resolveAliasedOption<T>(
  input: string,
  types: Record<string, T>,
  aliases: Record<string, T>,
  fallback: null,
): T | null;
export function resolveAliasedOption<T>(
  input: string,
  types: Record<string, T>,
  aliases: Record<string, T>,
  fallback: T | null,
): T | null {
  const lower = input.toLowerCase();
  // Object.hasOwn: `in` / bare indexing would match Object.prototype keys
  // ("constructor", "toString", ...) for untrusted config tokens.
  if (Object.hasOwn(types, lower)) return types[lower];
  if (Object.hasOwn(aliases, lower)) {
    const alias = aliases[lower];
    if (alias !== undefined) return alias;
  }
  return fallback;
}

/** Lowercase slug (a-z0-9 + hyphens, trimmed, max 40 chars) for stable content-item IDs. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Fast deterministic string hash (base36) for stable IDs when no URL is available. */
export function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
