import { describe, test, expect } from "bun:test";
import {
  aggregateParallelFeeds,
  aggregateSequentialFeeds,
  compareItemTimestampDesc,
  dedupeByKey,
  fetchAllBatched,
  fetchAllParallel,
  fetchAndConcat,
  mapAndConcat,
  finalizeFetchedItems,
  perSourceTotalLimit,
  sliceAndMap,
  sliceAndMapDefined,
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

describe("mapAndConcat", () => {
  test("concatenates results in key order", () => {
    const order: string[] = [];
    const out = mapAndConcat(["b", "a"], (key) => {
      order.push(key);
      return key === "a" ? [{ v: 1 }] : [{ v: 2 }, { v: 3 }];
    });
    expect(order).toEqual(["b", "a"]);
    expect(out).toEqual([{ v: 2 }, { v: 3 }, { v: 1 }]);
  });

  test("returns empty array when keys is empty", () => {
    const out = mapAndConcat([], () => [{ v: 1 }]);
    expect(out).toEqual([]);
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

describe("perSourceTotalLimit", () => {
  test("multiplies per-source cap by source count", () => {
    expect(perSourceTotalLimit(10, 3)).toBe(30);
  });

  test("returns MAX_SAFE_INTEGER when per-source cap is unlimited", () => {
    expect(perSourceTotalLimit(Number.MAX_SAFE_INTEGER, 5)).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("aggregateSequentialFeeds", () => {
  test("sequential-fetches, dedupes, filters by min score, sorts, and slices", async () => {
    const order: string[] = [];
    const out = await aggregateSequentialFeeds(
      ["b", "a"],
      async (key) => {
        order.push(key);
        return [
          { id: key === "a" ? "shared" : "b-only", score: key === "a" ? 10 : 8 },
          { id: "shared", score: 5 },
          { id: "low", score: 2 },
        ];
      },
      {
        limit: 2,
        dedupeKey: (item) => item.id,
        minScore: 5,
        scoreOf: (item) => item.score,
        sort: (a, b) => b.score - a.score,
      },
    );

    expect(order).toEqual(["b", "a"]);
    expect(out).toEqual([
      { id: "b-only", score: 8 },
      { id: "shared", score: 5 },
    ]);
  });
});

describe("aggregateParallelFeeds", () => {
  test("parallel-fetches, dedupes, sorts, and applies per-source total cap", async () => {
    const out = await aggregateParallelFeeds(
      ["a", "b"],
      async (key) => [
        {
          id: key === "a" ? "shared" : "b-only",
          timestamp: new Date(key === "a" ? "2024-01-01T00:00:00.000Z" : "2024-06-01T00:00:00.000Z"),
        },
        {
          id: "shared",
          timestamp: new Date("2024-03-01T00:00:00.000Z"),
        },
      ],
      {
        perSourceLimit: 1,
        dedupeKey: (item) => item.id,
      },
    );

    expect(out).toEqual([
      {
        id: "b-only",
        timestamp: new Date("2024-06-01T00:00:00.000Z"),
      },
      {
        id: "shared",
        timestamp: new Date("2024-01-01T00:00:00.000Z"),
      },
    ]);
  });
});

describe("fetchAllParallel", () => {
  test("fetches keys in parallel and flattens results", async () => {
    const order: string[] = [];
    const out = await fetchAllParallel(["b", "a"], async (key) => {
      order.push(key);
      return key === "a" ? [{ v: 1 }] : [{ v: 2 }, { v: 3 }];
    });
    expect(order.sort()).toEqual(["a", "b"]);
    expect(out).toEqual([{ v: 2 }, { v: 3 }, { v: 1 }]);
  });

  test("returns empty array when keys is empty", async () => {
    const out = await fetchAllParallel([], async () => [{ v: 1 }]);
    expect(out).toEqual([]);
  });
});

describe("fetchAllBatched", () => {
  test("fetches keys in batch-sized parallel groups preserving order", async () => {
    const calls: string[] = [];
    const out = await fetchAllBatched(["a", "b", "c", "d"], 2, async (key) => {
      calls.push(key);
      return key;
    });
    expect(out).toEqual(["a", "b", "c", "d"]);
    expect(calls).toEqual(["a", "b", "c", "d"]);
  });

  test("returns empty array when keys is empty", async () => {
    const out = await fetchAllBatched([], 5, async () => "x");
    expect(out).toEqual([]);
  });

  test("waits between batches when delayMs is set", async () => {
    const timestamps: number[] = [];
    await fetchAllBatched(["a", "b", "c"], 1, async (key) => {
      timestamps.push(Date.now());
      return key;
    }, 20);
    expect(timestamps).toHaveLength(3);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(15);
    expect(timestamps[2] - timestamps[1]).toBeGreaterThanOrEqual(15);
  });
});

describe("compareItemTimestampDesc", () => {
  test("orders newer timestamp first", () => {
    const older = { timestamp: new Date("2024-01-01T00:00:00.000Z"), id: "old" };
    const newer = { timestamp: new Date("2024-06-01T00:00:00.000Z"), id: "new" };
    expect(compareItemTimestampDesc(older, newer)).toBeGreaterThan(0);
    expect(compareItemTimestampDesc(newer, older)).toBeLessThan(0);
    expect(compareItemTimestampDesc(newer, newer)).toBe(0);
  });
});

describe("sliceAndMap", () => {
  test("slices before mapping so mapper runs only on kept items", () => {
    const mapped: number[] = [];
    const out = sliceAndMap([10, 20, 30, 40], 2, (n) => {
      mapped.push(n);
      return n * 2;
    });
    expect(out).toEqual([20, 40]);
    expect(mapped).toEqual([10, 20]);
  });
});

describe("sliceAndMapDefined", () => {
  test("slices before mapping and drops null/undefined results", () => {
    const mapped: number[] = [];
    const out = sliceAndMapDefined([1, 2, 3, 4, 5], 4, (n) => {
      mapped.push(n);
      return n % 2 === 0 ? n * 10 : null;
    });
    expect(out).toEqual([20, 40]);
    expect(mapped).toEqual([1, 2, 3, 4]);
  });
});

describe("finalizeFetchedItems", () => {
  test("dedupes, filters by min score, sorts, and slices", () => {
    const items = [
      { id: "a", score: 10 },
      { id: "b", score: 3 },
      { id: "a", score: 10 },
      { id: "c", score: 8 },
      { id: "d", score: 1 },
    ];
    const out = finalizeFetchedItems(items, {
      limit: 2,
      dedupeKey: (item) => item.id,
      minScore: 5,
      scoreOf: (item) => item.score,
      sort: (a, b) => b.score - a.score,
    });
    expect(out).toEqual([
      { id: "a", score: 10 },
      { id: "c", score: 8 },
    ]);
  });

  test("skips dedupe, filter, and sort when options omitted", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(finalizeFetchedItems(items, { limit: 2 })).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });

  test("dedupes flattened parallel fetch results by key", async () => {
    const fetched = await fetchAllParallel(
      ["a", "b"],
      async (key) => [
        { id: `${key}-1`, n: 1 },
        { id: "shared", n: key === "a" ? 1 : 2 },
      ],
    );
    const out = finalizeFetchedItems(fetched, {
      limit: 100,
      dedupeKey: (item) => item.id,
    });
    expect(out).toEqual([
      { id: "a-1", n: 1 },
      { id: "shared", n: 1 },
      { id: "b-1", n: 1 },
    ]);
  });
});