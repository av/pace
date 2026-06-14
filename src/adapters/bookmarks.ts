import { mapToContentItemsPerSource, type ContentItemProjection } from "./content-item";
import { warnAdapter, warnEmptyConfig } from "./empty-config";
import type { Adapter, AdapterConfig, ContentItem } from "./types";

export interface BookmarkEntry {
  title: string;
  url: string;
  description?: string;
  tags?: string[];
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function isValidUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function bookmarkSource(entry: BookmarkEntry): string {
  if (entry.tags && entry.tags.length > 0) {
    return `bookmarks:${entry.tags[0]}`;
  }
  return "bookmarks";
}

const adapter: Adapter = {
  name: "bookmarks",
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

    return mapToContentItemsPerSource(
      valid,
      (v) => bookmarkSource(v.entry),
      (v): ContentItemProjection => ({
        id: `bookmarks:${slugify(v.entry.title)}-${v.index}`,
        title: v.entry.title,
        url: v.entry.url,
        timestamp: now,
        body: v.entry.description,
      }),
    );
  },
};

export default adapter;
