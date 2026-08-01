import { describe, test, expect, beforeEach, afterEach, setSystemTime } from "bun:test";
import {
  formatSeconds,
  parseFeedDate,
  parseNaiveUtcFeedDate,
  parseUnixEpochSeconds,
} from "./adapters/dates";
import { spyConsole } from "./test/console-spy";

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

  test("warns on invalid date string but not on missing", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      parseFeedDate("not-a-date");
      expect(warn).toHaveBeenCalledWith(
        'dates: invalid feed date "not-a-date", using current time',
      );

      warn.mockClear();
      parseFeedDate(null);
      parseFeedDate("");
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("parseNaiveUtcFeedDate", () => {
  function withTimeZone<T>(tz: string, fn: () => T): T {
    const prev = process.env.TZ;
    process.env.TZ = tz;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  }

  test("parses naive datetimes as UTC regardless of host time zone", () => {
    withTimeZone("America/New_York", () => {
      // A raw new Date() would read this as 17:00Z (local Eastern time).
      expect(parseNaiveUtcFeedDate("2024-01-01T12:00:00").toISOString()).toBe(
        "2024-01-01T12:00:00.000Z",
      );
    });
  });

  test("handles fractional seconds and space separators", () => {
    withTimeZone("America/New_York", () => {
      expect(
        parseNaiveUtcFeedDate("2024-01-01T12:00:00.123456").toISOString(),
      ).toBe("2024-01-01T12:00:00.123Z");
      expect(parseNaiveUtcFeedDate("2024-01-01 12:00:00").toISOString()).toBe(
        "2024-01-01T12:00:00.000Z",
      );
      expect(parseNaiveUtcFeedDate("2024-01-01T12:00").toISOString()).toBe(
        "2024-01-01T12:00:00.000Z",
      );
    });
  });

  test("leaves zone-designated strings unchanged", () => {
    withTimeZone("America/New_York", () => {
      expect(
        parseNaiveUtcFeedDate("2024-01-01T12:00:00+02:00").toISOString(),
      ).toBe("2024-01-01T10:00:00.000Z");
      expect(parseNaiveUtcFeedDate("2024-01-01T12:00:00Z").toISOString()).toBe(
        "2024-01-01T12:00:00.000Z",
      );
    });
  });

  test("falls back to now for missing or invalid input", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      expect(parseNaiveUtcFeedDate().toISOString()).toBe(FIXED_NOW.toISOString());
      expect(parseNaiveUtcFeedDate(null).toISOString()).toBe(FIXED_NOW.toISOString());
      expect(warn).not.toHaveBeenCalled();

      expect(parseNaiveUtcFeedDate("not-a-date").toISOString()).toBe(
        FIXED_NOW.toISOString(),
      );
      expect(warn).toHaveBeenCalledWith(
        'dates: invalid feed date "not-a-date", using current time',
      );
    });
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

  test("warns on non-finite epoch seconds but not on missing", async () => {
    await spyConsole(["warn"], async ({ warn }) => {
      parseUnixEpochSeconds(Number.NaN);
      expect(warn).toHaveBeenCalledWith(
        "dates: invalid epoch seconds NaN, using current time",
      );

      warn.mockClear();
      parseUnixEpochSeconds(Number.POSITIVE_INFINITY);
      expect(warn).toHaveBeenCalledWith(
        "dates: invalid epoch seconds Infinity, using current time",
      );

      warn.mockClear();
      parseUnixEpochSeconds(null);
      parseUnixEpochSeconds();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe("formatSeconds", () => {
  test("formats sub-hour durations as m:ss", () => {
    expect(formatSeconds(0)).toBe("0:00");
    expect(formatSeconds(5)).toBe("0:05");
    expect(formatSeconds(754)).toBe("12:34");
  });

  test("formats hour-plus durations as h:mm:ss", () => {
    expect(formatSeconds(3600)).toBe("1:00:00");
    expect(formatSeconds(3723)).toBe("1:02:03");
  });

  test("floors fractional input", () => {
    expect(formatSeconds(5.9)).toBe("0:05");
    expect(formatSeconds(59.999)).toBe("0:59");
    expect(formatSeconds(3600.5)).toBe("1:00:00");
  });

  test("non-finite and negative input fall back to 0:00", () => {
    expect(formatSeconds(NaN)).toBe("0:00");
    expect(formatSeconds(Infinity)).toBe("0:00");
    expect(formatSeconds(-Infinity)).toBe("0:00");
    expect(formatSeconds(-3)).toBe("0:00");
  });
});