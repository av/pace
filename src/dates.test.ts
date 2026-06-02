import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import { parseFeedDate, parseUnixEpochSeconds } from "./adapters/dates";

const FIXED_NOW = new Date("2024-06-15T12:00:00.000Z");

beforeEach(() => setSystemTime(FIXED_NOW));
afterEach(() => setSystemTime());

describe("parseFeedDate", () => {
  test("parses valid ISO date strings", () => {
    expect(parseFeedDate("2023-01-02T03:04:05.000Z").toISOString()).toBe(
      "2023-01-02T03:04:05.000Z",
    );
  });

  test("returns fixed now when missing or invalid", () => {
    expect(parseFeedDate().toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseFeedDate(null).toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseFeedDate("").toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseFeedDate("not-a-date").toISOString()).toBe(FIXED_NOW.toISOString());
  });
});

describe("parseUnixEpochSeconds", () => {
  test("converts epoch seconds to Date", () => {
    expect(parseUnixEpochSeconds(0).toISOString()).toBe("1970-01-01T00:00:00.000Z");
    expect(parseUnixEpochSeconds(1718452800).toISOString()).toBe(
      "2024-06-15T12:00:00.000Z",
    );
  });

  test("returns fixed now when missing or non-finite", () => {
    expect(parseUnixEpochSeconds().toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseUnixEpochSeconds(null).toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseUnixEpochSeconds(Number.NaN).toISOString()).toBe(FIXED_NOW.toISOString());
    expect(parseUnixEpochSeconds(Number.POSITIVE_INFINITY).toISOString()).toBe(
      FIXED_NOW.toISOString(),
    );
  });
});