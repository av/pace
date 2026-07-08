import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import { warnAdapter, warnEmptyConfig } from "./empty-config";
import { simpleHash, slugify } from "../utils";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

export interface BookmarkEntry {
  title: string;
  url: string;
  description?: string;
  tags?: string[];
}

function isValidUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function bookmarkSource(entry: BookmarkEntry): string {
  const firstTag = entry.tags?.find((t) => t.trim() !== "");
  if (firstTag !== undefined) {
    return `bookmarks:${firstTag}`;
  }
  return "bookmarks";
}

const adapter: Adapter = {
  name: "bookmarks",
  // Items come entirely from config; the scheduler prunes `bookmarks:`-prefixed
  // rows not present in the latest fetch so removed/renamed entries don't
  // linger on the panel. Ids embed a hash of the URL (not the config index),
  // so reordering entries keeps ids stable and per-item state (summaries,
  // scores, first-seen timestamps) survives.
  declarative: true,
  async fetch(config: AdapterConfig): Promise<ContentItem[]> {
    const items = config.params?.items;

    if (!Array.isArray(items) || items.length === 0) {
      return warnEmptyConfig("bookmarks", "no items configured");
    }

    const now = new Date();
    const valid: { entry: BookmarkEntry; index: number }[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || typeof item !== "object") {
        warnAdapter("bookmarks", `items[${i}]: not an object, skipping`);
        continue;
      }
      if (typeof item.title !== "string" || item.title.trim() === "") {
        warnAdapter("bookmarks", `items[${i}]: missing or empty title, skipping`);
        continue;
      }
      if (typeof item.url !== "string" || item.url.trim() === "") {
        warnAdapter("bookmarks", `items[${i}]: missing or empty url, skipping`);
        continue;
      }
      if (!isValidUrl(item.url)) {
        warnAdapter("bookmarks", `items[${i}]: url must start with http:// or https://, skipping`);
        continue;
      }
      valid.push({
        entry: {
          title: item.title,
          url: item.url,
          description: typeof item.description === "string" ? item.description : undefined,
          tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown): t is string => typeof t === "string") : undefined,
        },
        index: i,
      });
    }

    if (valid.length === 0) {
      return warnEmptyConfig("bookmarks", "all items were invalid");
    }

    const nowMs = now.getTime();
    return mapToContentItemsPerSource(
      valid,
      (v) => bookmarkSource(v.entry),
      (v): ContentItemProjection => ({
        // URL-hash id: stable across config reorders (unlike an embedded
        // index), so upserts hit the same row and DB-side state survives.
        // The timestamp below (now - index) only orders the FIRST insert of
        // each entry; declarative saves preserve stored timestamps on
        // conflict (see saveItems preserveStoredTimestamps), so refreshes
        // stop re-stamping every bookmark to "just now".
        id: `bookmarks:${slugify(v.entry.title)}-${simpleHash(v.entry.url)}`,
        title: v.entry.title,
        url: v.entry.url,
        timestamp: new Date(nowMs - v.index),
        body: v.entry.description,
      }),
    );
  },
};

export default adapter;
