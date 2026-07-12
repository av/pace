import { htmlToText } from "./html-to-text";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 500 * 1024; // 500 KB
const MAX_EXTRACTED_CHARS = 8_000;
const MAX_CONCURRENCY = 5;
const MAX_REDIRECTS = 5;

export interface FetchItemContentsOptions {
  allowPrivateNetwork?: boolean;
  onPrivateNetworkBlocked?: () => void;
}

class PrivateNetworkBlockedError extends Error {}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 198 && (b === 18 || b === 19));
}

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) return isPrivateIpv4(address);
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1"
    || normalized.startsWith("fc") || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
}

async function assertContentFetchUrlAllowed(url: URL, allowPrivateNetwork: boolean): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  if (allowPrivateNetwork) return;
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname)
    ? [hostname]
    : (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new PrivateNetworkBlockedError("private network destination blocked");
  }
}

async function fetchAllowedContentUrl(url: string, signal: AbortSignal, allowPrivateNetwork: boolean): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    await assertContentFetchUrlAllowed(current, allowPrivateNetwork);
    const response = await fetch(current, { signal, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === MAX_REDIRECTS) throw new Error("too many redirects");
    await response.body?.cancel().catch(() => {});
    current = new URL(location, current);
  }
  throw new Error("too many redirects");
}

/** Fetch URL and extract plain text; returns null on any failure. */
async function fetchItemContent(url: string, options: FetchItemContentsOptions): Promise<string | null> {
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchAllowedContentUrl(
      url,
      controller.signal,
      options.allowPrivateNetwork ?? false,
    );
    if (!response.ok) return null;

    const contentType = response.headers.get("content-type") ?? "";
    const isTextual = contentType.includes("text/html") || contentType.includes("text/plain");
    if (!isTextual) return null;

    // Read up to MAX_RESPONSE_BYTES to avoid holding huge buffers.
    const reader = response.body?.getReader();
    if (!reader) return null;

    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      totalBytes += value.byteLength;
      if (totalBytes <= MAX_RESPONSE_BYTES) {
        chunks.push(value);
      } else {
        // Keep only up to the cap.
        const remaining = MAX_RESPONSE_BYTES - (totalBytes - value.byteLength);
        chunks.push(value.slice(0, remaining));
        reader.cancel().catch(() => {});
        break;
      }
    }

    const combined = new Uint8Array(chunks.reduce((acc, c) => acc + c.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const raw = new TextDecoder().decode(combined);
    const text = contentType.includes("text/html") ? htmlToText(raw) : raw.replace(/\s+/g, " ").trim();
    return text.slice(0, MAX_EXTRACTED_CHARS) || null;
  } catch (error) {
    if (error instanceof PrivateNetworkBlockedError) options.onPrivateNetworkBlocked?.();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch page content for each item URL with capped concurrency.
 * Returns a Map of item id → extracted text (missing = fetch failed/skipped).
 */
export async function fetchItemContents(
  items: Array<{ id: string; url: string }>,
  options: FetchItemContentsOptions = {},
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Process in batches of MAX_CONCURRENCY.
  for (let i = 0; i < items.length; i += MAX_CONCURRENCY) {
    const batch = items.slice(i, i + MAX_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (item) => {
        const text = await fetchItemContent(item.url, options);
        return { id: item.id, text };
      }),
    );
    for (const { id, text } of settled) {
      if (text) result.set(id, text);
    }
  }

  return result;
}
