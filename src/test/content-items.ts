import type { ContentItem } from "../adapters/types";
import type { ContentItemRow } from "../db";

let contentItemSeq = 0;

function nextTestId(prefix = "item"): string {
  return `${prefix}-${++contentItemSeq}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Factory for adapter/domain `ContentItem` test fixtures (db, llm). */
export function makeContentItem(
  overrides: Partial<ContentItem> & { id?: string } = {},
): ContentItem {
  const id = overrides.id ?? nextTestId();
  const now = new Date();
  return {
    title: `title-${id}`,
    url: `https://ex.com/${id}`,
    source: "testsrc",
    body: undefined as string | undefined,
    ...overrides,
    id,
    timestamp: overrides.timestamp ?? now,
  };
}

/** Factory for persisted `ContentItemRow` test fixtures (layout, transforms). */
export function makeContentItemRow(
  overrides: Partial<ContentItemRow> = {},
): ContentItemRow {
  const now = new Date().toISOString();
  const id = overrides.id ?? nextTestId("row");
  return {
    panel_id: "panel-1",
    title: "Test Title",
    url: "https://example.com",
    source: "testsrc",
    body: "Default body content here.",
    summary: null,
    origins: null,
    applied_transforms: null,
    score: null,
    ...overrides,
    id,
    timestamp: overrides.timestamp ?? now,
    fetched_at: overrides.fetched_at ?? now,
  };
}