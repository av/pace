import { htmlToText } from "./html-to-text";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 500 * 1024; // 500 KB
const MAX_EXTRACTED_CHARS = 8_000;
const MAX_CONCURRENCY = 5;

/** Fetch URL and extract plain text; returns null on any failure. */
async function fetchItemContent(url: string): Promise<string | null> {
  if (!url) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
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
  } catch {
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
): Promise<Map<string, string>> {
  const result = new Map<string, string>();

  // Process in batches of MAX_CONCURRENCY.
  for (let i = 0; i < items.length; i += MAX_CONCURRENCY) {
    const batch = items.slice(i, i + MAX_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (item) => {
        const text = await fetchItemContent(item.url);
        return { id: item.id, text };
      }),
    );
    for (const { id, text } of settled) {
      if (text) result.set(id, text);
    }
  }

  return result;
}
