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