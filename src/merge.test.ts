import { describe, test, expect } from "bun:test";
import {
  dedupeByKey,
  fetchAndConcat,
  sliceToLimit,
  sortByCreatedAtDesc,
} from "./adapters/merge";

describe("dedupeByKey", () => {
  test("keeps first occurrence per key", () => {
    const items = [
      { id: "a", n: 1 },
      { id: "b", n: 2 },
      { id: "a", n: 3 },
    ];
    expect(dedupeByKey(items, (x) => x.id)).toEqual([
      { id: "a", n: 1 },
      { id: "b", n: 2 },
    ]);
  });

  test("returns empty array for empty input", () => {
    expect(dedupeByKey([], (x: { id: string }) => x.id)).toEqual([]);
  });
});

describe("fetchAndConcat", () => {
  test("concatenates results in key order", async () => {
    const order: string[] = [];
    const out = await fetchAndConcat(["b", "a"], async (key) => {
      order.push(key);
      return key === "a" ? [{ v: 1 }] : [{ v: 2 }, { v: 3 }];
    });
    expect(order).toEqual(["b", "a"]);
    expect(out).toEqual([{ v: 2 }, { v: 3 }, { v: 1 }]);
  });

  test("returns empty array when keys is empty", async () => {
    const out = await fetchAndConcat([], async () => [{ v: 1 }]);
    expect(out).toEqual([]);
  });
});

describe("sliceToLimit", () => {
  test("returns at most limit items from the start", () => {
    expect(sliceToLimit([1, 2, 3, 4], 2)).toEqual([1, 2]);
    expect(sliceToLimit([1, 2], 5)).toEqual([1, 2]);
    expect(sliceToLimit([], 3)).toEqual([]);
  });
});

describe("sortByCreatedAtDesc", () => {
  test("sorts items newest-first by created_at", () => {
    const items = [
      { created_at: "2024-01-01T00:00:00.000Z", id: "old" },
      { created_at: "2024-06-01T00:00:00.000Z", id: "new" },
      { created_at: "2024-03-01T00:00:00.000Z", id: "mid" },
    ];
    sortByCreatedAtDesc(items);
    expect(items.map((x) => x.id)).toEqual(["new", "mid", "old"]);
  });
});