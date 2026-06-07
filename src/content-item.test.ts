import { describe, expect, test } from "bun:test";
import { mapToContentItems, sliceMapToContentItems } from "./adapters/content-item";

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

describe("sliceMapToContentItems", () => {
  test("slices before mapping and attaches shared source", () => {
    const ts = new Date("2024-01-15T12:00:00Z");
    const items = sliceMapToContentItems(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      2,
      "github:trending:typescript",
      (row) => ({
        id: `github:trending:repo-${row.id}:daily`,
        title: `repo-${row.id}`,
        url: `https://github.com/repo-${row.id}`,
        timestamp: ts,
      }),
    );

    expect(items).toEqual([
      {
        id: "github:trending:repo-1:daily",
        title: "repo-1",
        url: "https://github.com/repo-1",
        source: "github:trending:typescript",
        timestamp: ts,
      },
      {
        id: "github:trending:repo-2:daily",
        title: "repo-2",
        url: "https://github.com/repo-2",
        source: "github:trending:typescript",
        timestamp: ts,
      },
    ]);
  });
});