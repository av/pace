import { sliceAndMap } from "./merge";
import type { ContentItem } from "./types";

export type ContentItemProjection = Pick<ContentItem, "id" | "title" | "url" | "timestamp"> & {
  body?: string;
};

/** Map post-fetch records to ContentItems with a shared source label (adapter terminal pipeline). */
export function mapToContentItems<T>(
  items: readonly T[],
  source: string,
  project: (item: T) => ContentItemProjection,
): ContentItem[] {
  return items.map((item) => ({ source, ...project(item) }));
}

/** Map post-fetch records to ContentItems with per-item source labels (multi-source merge). */
export function mapToContentItemsPerSource<T>(
  items: readonly T[],
  sourceOf: (item: T) => string,
  project: (item: T) => ContentItemProjection,
): ContentItem[] {
  return items.map((item) => ({ source: sourceOf(item), ...project(item) }));
}

/** Per-feed cap then map to ContentItems (sliceAndMap + shared source label). */
export function sliceMapToContentItems<T>(
  items: readonly T[],
  limit: number,
  source: string,
  project: (item: T) => ContentItemProjection,
): ContentItem[] {
  return sliceAndMap(items, limit, (item) => ({ source, ...project(item) }));
}