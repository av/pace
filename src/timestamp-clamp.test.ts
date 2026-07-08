import { test, expect, describe } from "bun:test";
import { installTempDbHooks } from "./test/temp-db";
import { clampFutureTimestamp, FUTURE_TIMESTAMP_TOLERANCE_MS } from "./utils";
import {
  saveItems,
  replacePanelItems,
  getAllItemsByPanel,
  coreContentItemFields,
} from "./db";
import {
  makeContentItem as makeItem,
  makeContentItemRow as makeRow,
} from "./test/content-items";

const NOW = Date.parse("2026-07-08T12:00:00.000Z");
const NOW_ISO = new Date(NOW).toISOString();

describe("clampFutureTimestamp", () => {
  test("past timestamps pass through unchanged", () => {
    const past = "2026-07-08T11:00:00.000Z";
    expect(clampFutureTimestamp(past, NOW)).toBe(past);
  });

  test("future timestamps within tolerance pass through unchanged", () => {
    const marginal = new Date(NOW + FUTURE_TIMESTAMP_TOLERANCE_MS).toISOString();
    expect(clampFutureTimestamp(marginal, NOW)).toBe(marginal);
  });

  test("future timestamps beyond tolerance clamp to now", () => {
    const skewed = new Date(NOW + FUTURE_TIMESTAMP_TOLERANCE_MS + 1).toISOString();
    expect(clampFutureTimestamp(skewed, NOW)).toBe(NOW_ISO);
    const farFuture = "2030-01-01T00:00:00.000Z";
    expect(clampFutureTimestamp(farFuture, NOW)).toBe(NOW_ISO);
  });

  test("unparseable timestamps pass through unchanged", () => {
    expect(clampFutureTimestamp("not-a-date", NOW)).toBe("not-a-date");
    expect(clampFutureTimestamp("", NOW)).toBe("");
  });
});

describe("future-timestamp clamp at ingestion", () => {
  installTempDbHooks({ prefix: "pace-tsclamp-" });

  test("saveItems clamps a far-future item so it no longer sort-pins over legit items", () => {
    const future = makeItem({
      id: "future",
      url: "https://ex.com/future",
      timestamp: new Date("2035-01-01T00:00:00.000Z"),
    });
    saveItems("p1", [future]);
    const stored = getAllItemsByPanel("p1").find((r) => r.id === "future");
    expect(stored).toBeDefined();
    const storedMs = Date.parse(stored!.timestamp);
    // Clamped to (approximately) save time, not the year 2035.
    expect(storedMs).toBeLessThanOrEqual(Date.now() + 1000);
    expect(storedMs).toBeGreaterThan(Date.now() - 60_000);
  });

  test("saveItems leaves past and within-tolerance timestamps untouched", () => {
    const past = new Date(Date.now() - 3_600_000);
    const marginal = new Date(Date.now() + 60_000);
    saveItems("p1", [
      makeItem({ id: "past", url: "https://ex.com/past", timestamp: past }),
      makeItem({ id: "marginal", url: "https://ex.com/marginal", timestamp: marginal }),
    ]);
    const rows = getAllItemsByPanel("p1");
    expect(rows.find((r) => r.id === "past")!.timestamp).toBe(past.toISOString());
    expect(rows.find((r) => r.id === "marginal")!.timestamp).toBe(marginal.toISOString());
  });

  test("re-saving the same future-dated item keeps the first clamp (no re-pinning each refresh)", async () => {
    const item = makeItem({
      id: "future",
      url: "https://ex.com/future",
      timestamp: new Date("2035-01-01T00:00:00.000Z"),
    });
    saveItems("p1", [item]);
    const first = getAllItemsByPanel("p1").find((r) => r.id === "future")!.timestamp;
    await new Promise((r) => setTimeout(r, 15));
    saveItems("p1", [item]);
    const second = getAllItemsByPanel("p1").find((r) => r.id === "future")!.timestamp;
    // A fresh clamp would advance by >= 15ms; stability keeps the stored value.
    expect(second).toBe(first);
  });

  test("clamp does not disturb id or upsert identity (dedup unaffected)", () => {
    const item = makeItem({
      id: "future",
      url: "https://ex.com/future",
      timestamp: new Date("2035-01-01T00:00:00.000Z"),
    });
    saveItems("p1", [item]);
    saveItems("p1", [item]);
    const copies = getAllItemsByPanel("p1").filter((r) => r.id === "future");
    expect(copies.length).toBe(1);
  });

  test("replacePanelItems clamps future-dated rows persisted by pre-clamp versions", () => {
    const row = makeRow({
      id: "legacy-future",
      panel_id: "p1",
      timestamp: "2035-01-01T00:00:00.000Z",
    });
    replacePanelItems("p1", [row]);
    const stored = getAllItemsByPanel("p1").find((r) => r.id === "legacy-future")!;
    expect(Date.parse(stored.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("coreContentItemFields clamps Date and string inputs alike", () => {
    const fields = coreContentItemFields(
      makeItem({ id: "d", timestamp: new Date("2035-01-01T00:00:00.000Z") }),
    );
    expect(Date.parse(fields.timestamp)).toBeLessThanOrEqual(Date.now() + 1000);
    const sane = coreContentItemFields(
      makeItem({ id: "s", timestamp: new Date("2026-01-01T00:00:00.000Z") }),
    );
    expect(sane.timestamp).toBe("2026-01-01T00:00:00.000Z");
  });
});
