import { describe, expect, test } from "bun:test";
import { mapToContentItems } from "./adapters/content-item";

describe("mapToContentItems", () => {
  test("attaches shared source to each projected item", () => {
    const ts = new Date("2024-01-15T12:00:00Z");
    const items = mapToContentItems(
      [{ id: 1, title: "A" }, { id: 2, title: "B" }],
      "reddit:r/test",
      (row) => ({
        id: `reddit:${row.id}`,
        title: row.title,
        url: `https://reddit.com/${row.id}`,
        timestamp: ts,
        body: "42 points",
      }),
    );

    expect(items).toEqual([
      {
        id: "reddit:1",
        title: "A",
        url: "https://reddit.com/1",
        source: "reddit:r/test",
        timestamp: ts,
        body: "42 points",
      },
      {
        id: "reddit:2",
        title: "B",
        url: "https://reddit.com/2",
        source: "reddit:r/test",
        timestamp: ts,
        body: "42 points",
      },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(mapToContentItems([], "hackernews:top", () => ({
      id: "hn:0",
      title: "x",
      url: "https://example.com",
      timestamp: new Date(),
    }))).toEqual([]);
  });
});