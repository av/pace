import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { resolveJsonPath, parseJsonPath, interpolateEnvVars } from "./adapters/counter";
import adapter from "./adapters/counter";
import type { AdapterConfig, ContentItem } from "./adapters/types";
import { abbreviateNumber, coerceCounterNumber, formatCounterValue, COUNTER_VALUE_FALLBACK, parseCounterBody } from "./layout/counter-panel";
import { renderDashboard } from "./layout/dashboard";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { makeContentItemRow } from "./test/content-items";

/** Render counter items through the actual CounterPanel and return the HTML. */
function renderCounterPanel(items: ContentItem[]): string {
  const rows = items.map((item) =>
    makeContentItemRow({
      id: item.id,
      title: item.title,
      body: item.body ?? undefined,
      source: item.source,
      url: item.url,
    }),
  );
  const node = panelCfg("TestPanel", "counter", { display: "counter" });
  const layout = flexCfg("row", [node]);
  return renderDashboard({
    layout,
    panelData: new Map([["TestPanel", { panelId: "test", items: rows, lastRefreshedAt: null }]]),
    updatedAt: "now",
  });
}

describe("counter adapter", () => {
  describe("resolveJsonPath", () => {
    test("resolves simple dot notation", () => {
      const obj = { foo: { bar: { baz: 42 } } };
      expect(resolveJsonPath(obj, "foo.bar.baz")).toBe(42);
    });

    test("resolves bracket array access", () => {
      const obj = { data: [10, 20, 30] };
      expect(resolveJsonPath(obj, "data[1]")).toBe(20);
    });

    test("resolves mixed dot and bracket notation", () => {
      const obj = { data: { metrics: [{ value: 99 }] } };
      expect(resolveJsonPath(obj, "data.metrics[0].value")).toBe(99);
    });

    test("throws on path not found (missing key)", () => {
      const obj = { foo: { bar: 1 } };
      expect(() => resolveJsonPath(obj, "foo.baz")).toThrow(/path "foo.baz" not found/);
    });

    test("throws on path not found (traversing non-object)", () => {
      const obj = { foo: 42 };
      expect(() => resolveJsonPath(obj, "foo.bar")).toThrow(/cannot traverse/);
    });

    test("throws on array index out of bounds", () => {
      const obj = { arr: [1, 2] };
      expect(() => resolveJsonPath(obj, "arr[5]")).toThrow(/out of bounds/);
    });

    test("throws when expecting array but got object", () => {
      const obj = { data: { notArray: true } };
      expect(() => resolveJsonPath(obj, "data[0]")).toThrow(/expected array/);
    });

    test("resolves string values", () => {
      const obj = { status: "UP" };
      expect(resolveJsonPath(obj, "status")).toBe("UP");
    });

    test("resolves null values", () => {
      const obj = { value: null };
      expect(resolveJsonPath(obj, "value")).toBe(null);
    });

    test("blocks __proto__ traversal via prototype chain", () => {
      const obj = { foo: "bar" };
      expect(() => resolveJsonPath(obj, "__proto__")).toThrow(/does not exist/);
    });

    test("blocks constructor traversal via prototype chain", () => {
      const obj = { foo: "bar" };
      expect(() => resolveJsonPath(obj, "constructor")).toThrow(/does not exist/);
    });

    test("allows __proto__ when it is an own property of the data", () => {
      const obj = Object.create(null);
      obj.__proto__ = { secret: 42 };
      expect(resolveJsonPath(obj, "__proto__.secret")).toBe(42);
    });

  });

  describe("parseJsonPath", () => {
    test("throws on malformed bracket (unclosed)", () => {
      expect(() => parseJsonPath("arr[0")).toThrow(/unclosed bracket/);
    });

    test("throws on invalid array index", () => {
      expect(() => parseJsonPath("arr[-1]")).toThrow(/invalid array index/);
    });
  });

  describe("interpolateEnvVars", () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // Restore env
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      }
    });

    test("interpolates a single env var", () => {
      process.env.TEST_COUNTER_TOKEN = "abc123";
      expect(interpolateEnvVars("Bearer ${TEST_COUNTER_TOKEN}")).toBe("Bearer abc123");
    });

    test("replaces missing env vars with empty string", () => {
      expect(interpolateEnvVars("key=${DEFINITELY_NOT_SET_COUNTER_TEST}")).toBe("key=");
    });

  });

  describe("adapter fetch", () => {
    let warnSpy: ReturnType<typeof spyOn>;
    let fetchSpy: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      if (fetchSpy) fetchSpy.mockRestore();
    });

    test("renders stat card with value, label, and unit", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ stargazers_count: 42000 }), { status: 200 }),
      );

      const config: AdapterConfig & { name?: string } = {
        type: "counter",
        params: {
          url: "https://api.github.com/repos/test/repo",
          json_path: "stargazers_count",
          label: "Stars",
          unit: "k",
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // Abbreviated value visible to user
      expect(html).toContain("42k");
      // Label visible to user
      expect(html).toContain("Stars");
      // Unit visible to user
      expect(html).toContain("k</span>");
    });

    test("uses adapter type for label fallback when unnamed", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 10 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      const result = await adapter.fetch(config);
      expect(result[0].title).toBe("counter");
    });

    test("uses adapter name for label fallback when named", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 10 }), { status: 200 }),
      );

      const config: AdapterConfig & { name?: string } = {
        type: "counter",
        name: "bun-stars",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      const result = await adapter.fetch(config);
      expect(result[0].title).toBe("bun-stars");
    });

    test("non-string label and unit params fall back instead of leaking into the item", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 10 }), { status: 200 }),
      );

      const config: AdapterConfig & { name?: string } = {
        type: "counter",
        name: "typed",
        params: {
          url: "https://example.com/api",
          json_path: "value",
          // config-validate does not type-check label/unit; a YAML number
          // must not become the item title or a body unit.
          label: 42,
          unit: 7,
        },
      };

      const result = await adapter.fetch(config);
      expect(result[0].title).toBe("typed");
      expect(JSON.parse(result[0].body ?? "{}")).toEqual({ value: 10 });
    });

    test("renders trend-up arrow when current > previous from compare_url", async () => {
      fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ current: 50 }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ current: 38 }), { status: 200 }),
        );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "current",
          compare_url: "https://example.com/api?period=previous",
          compare_path: "current",
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // Trend arrow present and pointing up (50 > 38)
      expect(html).toContain("stat-trend-up");
      expect(html).toContain("trending up");
    });

    test("emits one redacted compare_url warning and keeps current value", async () => {
      fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ value: 100 }), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
          compare_url: "https://example.com/api?access_token=compare-secret&window=24h",
        },
      };

      const result = await adapter.fetch(config);
      expect(result).toHaveLength(1);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(100);
      expect(body.previous).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        "counter: failed to fetch compare_url https://example.com/api?access_token=[REDACTED]&window=24h: HTTP error 503",
      );
    });

    test("throws on missing url param", async () => {
      const config: AdapterConfig = {
        type: "counter",
        params: { json_path: "value" },
      };
      await expect(adapter.fetch(config)).rejects.toThrow(/url is required/);
    });

    test("throws on missing json_path param", async () => {
      const config: AdapterConfig = {
        type: "counter",
        params: { url: "https://example.com/api" },
      };

      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 1 }), { status: 200 }),
      );

      await expect(adapter.fetch(config)).rejects.toThrow(/json_path is required/);
    });

    test("throws on non-200 status", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Not Found", { status: 404 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      await expect(adapter.fetch(config)).rejects.toThrow(/failed to fetch/);
    });

    test("throws on network error", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("DNS failure"));

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      await expect(adapter.fetch(config)).rejects.toThrow(/error fetching/);
    });

    test("throws on invalid JSON response", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("not json!", { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      await expect(adapter.fetch(config)).rejects.toThrow(/error reading/);
    });

    test("throws on path not found in response", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ other: 1 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "missing.path",
        },
      };

      await expect(adapter.fetch(config)).rejects.toThrow(/path "missing.path" not found/);
    });

    test("renders non-numeric string value in stat card", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ status: "UP" }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "status",
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // "UP" visible in stat card value
      expect(html).toContain("UP");
      // No trend arrow (string values cannot trend)
      expect(html).not.toContain("stat-trend-up");
      expect(html).not.toContain("stat-trend-down");
    });

    test("renders trend arrow when compare_path defaults to json_path", async () => {
      fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rate: 5.2 }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ rate: 4.8 }), { status: 200 }),
        );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "rate",
          compare_url: "https://example.com/api?old",
          // no compare_path -- should default to json_path
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // 5.2 > 4.8, so trend is up (proves compare_path defaulted to json_path)
      expect(html).toContain("stat-trend-up");
      expect(html).toContain("trending up");
    });

    test("handles JSON response that is a bare string", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify("hello"), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "anything",
        },
      };

      // A bare string is not an object, so path traversal should fail
      await expect(adapter.fetch(config)).rejects.toThrow(/cannot traverse into string/);
    });

    test("handles JSON response that is a bare number", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(42), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "anything",
        },
      };

      // A bare number is not an object, so path traversal should fail
      await expect(adapter.fetch(config)).rejects.toThrow(/cannot traverse into number/);
    });

    test("handles JSON response that is null", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("null", { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
        },
      };

      // null is not an object, so path traversal should fail
      await expect(adapter.fetch(config)).rejects.toThrow(/cannot traverse/);
    });

    test("renders value resolved through nested arrays in stat card", async () => {
      const data = { data: [{ metrics: [{ skip: true }, { value: 777 }] }] };
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(data), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "data[0].metrics[1].value",
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // 777 < 10,000 so not abbreviated, appears as-is in stat card
      expect(html).toContain("777");
    });

    test("throws on empty JSON object with any path", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({}), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "missing",
        },
      };

      await expect(adapter.fetch(config)).rejects.toThrow(/does not exist/);
    });

    test("handles zero value without treating it as falsy", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 0 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "count",
        },
      };

      const result = await adapter.fetch(config);
      expect(result).toHaveLength(1);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(0);
      // Ensure it wasn't silently treated as "no value"
      expect(body.value).not.toBeUndefined();
      expect(body.value).not.toBeNull();
    });

    test("handles false boolean value at path", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ healthy: false }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "healthy",
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(false);
    });

    test("renders no trend arrow when current equals previous", async () => {
      fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ count: 500 }), { status: 200 }),
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ count: 500 }), { status: 200 }),
        );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "count",
          compare_url: "https://example.com/api?period=previous",
          compare_path: "count",
        },
      };

      const result = await adapter.fetch(config);
      const html = renderCounterPanel(result);
      // Value visible
      expect(html).toContain("500");
      // No trend arrows when value === previous
      expect(html).not.toContain("stat-trend-up");
      expect(html).not.toContain("stat-trend-down");
      // Aria-label shows "unchanged"
      expect(html).toContain("unchanged");
    });

  });
});

describe("counter panel rendering", () => {
  describe("abbreviateNumber", () => {
    test("abbreviates millions", () => {
      expect(abbreviateNumber(1500000)).toBe("1.5M");
      expect(abbreviateNumber(2000000)).toBe("2M");
    });

    test("abbreviates tens of thousands", () => {
      expect(abbreviateNumber(42000)).toBe("42k");
      expect(abbreviateNumber(10500)).toBe("10.5k");
    });

    test("does not abbreviate small numbers", () => {
      expect(abbreviateNumber(9999)).toBe("9999");
      expect(abbreviateNumber(100)).toBe("100");
      expect(abbreviateNumber(0)).toBe("0");
    });

    test("handles exact boundaries", () => {
      expect(abbreviateNumber(10000)).toBe("10k");
      expect(abbreviateNumber(1000000)).toBe("1M");
    });

    test("handles negative numbers", () => {
      expect(abbreviateNumber(-15000)).toBe("-15k");
      expect(abbreviateNumber(-2000000)).toBe("-2M");
    });

    test("returns string representation for non-numbers", () => {
      expect(abbreviateNumber("UP")).toBe("UP");
      expect(abbreviateNumber(true)).toBe("true");
      expect(abbreviateNumber(null)).toBe("null");
    });

    test("handles NaN and Infinity", () => {
      expect(abbreviateNumber(NaN)).toBe("NaN");
      expect(abbreviateNumber(Infinity)).toBe("Infinity");
    });

    test("abbreviates billions and trillions", () => {
      expect(abbreviateNumber(1_500_000_000)).toBe("1.5B");
      expect(abbreviateNumber(2_000_000_000_000)).toBe("2T");
      expect(abbreviateNumber(-3_200_000_000)).toBe("-3.2B");
    });

    test("uses exponential notation beyond trillions", () => {
      expect(abbreviateNumber(1e21)).toBe("1.0e21");
      expect(abbreviateNumber(1e15)).toBe("1.0e15");
      expect(abbreviateNumber(999_000_000_000_000)).toBe("999T");
    });

    test("promotes to the next tier when rounding would display >= 1000", () => {
      // k -> M (previously handled)
      expect(abbreviateNumber(999_950)).toBe("1M");
      expect(abbreviateNumber(999_949)).toBe("999.9k");
      // M -> B (previously rendered "1000M")
      expect(abbreviateNumber(999_950_000)).toBe("1B");
      expect(abbreviateNumber(999_949_999)).toBe("999.9M");
      // B -> T (previously rendered "1000B")
      expect(abbreviateNumber(999_950_000_000)).toBe("1T");
      expect(abbreviateNumber(999_949_999_999)).toBe("999.9B");
      // T -> exponential (previously rendered "1000T")
      expect(abbreviateNumber(999_950_000_000_000)).toBe("1.0e15");
      expect(abbreviateNumber(999_949_999_999_999)).toBe("999.9T");
      // Negative values promote too
      expect(abbreviateNumber(-999_950_000)).toBe("-1B");
      expect(abbreviateNumber(-999_950_000_000_000)).toBe("-1.0e15");
    });
  });

  describe("coerceCounterNumber", () => {
    test("passes through finite numbers", () => {
      expect(coerceCounterNumber(42)).toBe(42);
      expect(coerceCounterNumber(-1.5)).toBe(-1.5);
      expect(coerceCounterNumber(0)).toBe(0);
    });

    test("parses numeric strings", () => {
      expect(coerceCounterNumber("42000")).toBe(42000);
      expect(coerceCounterNumber("  3.14 ")).toBe(3.14);
      expect(coerceCounterNumber("1e3")).toBe(1000);
    });

    test("rejects everything else", () => {
      expect(coerceCounterNumber(NaN)).toBeNull();
      expect(coerceCounterNumber(Infinity)).toBeNull();
      expect(coerceCounterNumber("")).toBeNull();
      expect(coerceCounterNumber("   ")).toBeNull();
      expect(coerceCounterNumber("UP")).toBeNull();
      expect(coerceCounterNumber(null)).toBeNull();
      expect(coerceCounterNumber(undefined)).toBeNull();
      expect(coerceCounterNumber({})).toBeNull();
      expect(coerceCounterNumber([1])).toBeNull();
      expect(coerceCounterNumber(true)).toBeNull();
    });
  });

  describe("formatCounterValue", () => {
    test("abbreviates finite numbers and numeric strings", () => {
      expect(formatCounterValue(1500000)).toEqual({ display: "1.5M", full: "1500000" });
      expect(formatCounterValue("42000")).toEqual({ display: "42k", full: "42000" });
    });

    test("shows short non-numeric strings and booleans as-is", () => {
      expect(formatCounterValue("UP")).toEqual({ display: "UP", full: "UP" });
      expect(formatCounterValue(" healthy ")).toEqual({ display: "healthy", full: "healthy" });
      expect(formatCounterValue(true)).toEqual({ display: "true", full: "true" });
      expect(formatCounterValue(false)).toEqual({ display: "false", full: "false" });
    });

    test("falls back for objects, arrays, null, NaN, Infinity", () => {
      for (const bad of [{}, { a: 1 }, [1, 2], null, undefined, NaN, Infinity, -Infinity]) {
        expect(formatCounterValue(bad)).toEqual({ display: COUNTER_VALUE_FALLBACK, full: "unavailable" });
      }
    });

    test("falls back for empty and overlong strings", () => {
      expect(formatCounterValue("")).toEqual({ display: COUNTER_VALUE_FALLBACK, full: "unavailable" });
      expect(formatCounterValue("x".repeat(41))).toEqual({ display: COUNTER_VALUE_FALLBACK, full: "unavailable" });
    });
  });
});

describe("counter config validation", () => {
  // These tests use loadConfig to validate counter adapter params and panel display
  const fs = require("node:fs");
  const path = require("node:path");
  const os = require("node:os");
  const { loadConfig } = require("./config");

  let tmpDir: string;
  let configPath: string;

  function setConfig(yaml: string): void {
    fs.writeFileSync(configPath, yaml);
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-counter-"));
    configPath = path.join(tmpDir, "config.yaml");
    process.env.PACE_CONFIG = configPath;
  });

  afterEach(() => {
    delete process.env.PACE_CONFIG;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("accepts valid counter adapter config", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.github.com/repos/oven-sh/bun
      json_path: stargazers_count
      label: "Bun Stars"
layout:
  panel: Stars
  display: counter
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts counter adapter with all params", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.github.com/repos/oven-sh/bun
      json_path: stargazers_count
      label: "Stars"
      unit: "k"
      compare_url: https://api.github.com/repos/oven-sh/bun
      compare_path: forks_count
      headers:
        Authorization: "Bearer token"
layout:
  panel: Stats
  display: counter
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects counter adapter without url", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      json_path: value
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/url is required for counter adapter/);
  });

  test("rejects counter adapter without json_path", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/json_path is required for counter adapter/);
  });

  test("rejects counter adapter with invalid url scheme", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: ftp://example.com/data
      json_path: value
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/disallowed scheme/);
  });

  test("rejects counter adapter with invalid json_path format", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: "$.foo.bar"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/valid dot-notation path/);
  });

  test("rejects counter adapter with __proto__ in json_path", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: "__proto__"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/disallowed segment/);
  });

  test("rejects counter adapter with constructor in json_path", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: "data.constructor"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/disallowed segment/);
  });

  test("rejects counter adapter with non-object headers", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      headers: "not an object"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/headers must be an object/);
  });

  test("rejects counter adapter with non-string header value", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      headers:
        X-Value: 42
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/headers.X-Value must be a string/);
  });

  test("rejects counter adapter with unknown param", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      bogus: true
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/not a valid counter param/);
  });

  test("accepts panel with display: counter", () => {
    const yaml = `
adapters:
  - type: hackernews
layout:
  panel: Quick Stats
  display: counter
  source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects panel with invalid display value", () => {
    const yaml = `
adapters:
  - type: hackernews
layout:
  panel: Quick Stats
  display: sparkline
  source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/display must be one of/);
  });

  test("accepts panel without display field", () => {
    const yaml = `
adapters:
  - type: hackernews
layout:
  panel: News
  source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts counter adapter with http://localhost url", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: http://localhost:9090/metrics
      json_path: data.current
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts valid compare_path", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: data.current
      compare_url: https://example.com/api?old
      compare_path: data.previous
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects compare_path with invalid format", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      compare_url: https://example.com/api?old
      compare_path: "$.invalid.path"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/compare_path must be a valid dot-notation path/);
  });

  test("rejects compare_path with __proto__ segment", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      compare_url: https://example.com/api?old
      compare_path: "__proto__"
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/compare_path contains a disallowed segment/);
  });

  test("rejects empty compare_path", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      compare_url: https://example.com/api?old
      compare_path: ""
layout:
  panel: Stats
  source:
    - adapter: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/compare_path/);
  });
});

describe("parseCounterBody robustness", () => {
  test("parses valid counter body with value, unit, previous", () => {
    const result = parseCounterBody('{"value":42,"unit":"%","previous":38}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(42);
    expect(result!.unit).toBe("%");
    expect(result!.previous).toBe(38);
  });

  test("parses body with only value key", () => {
    const result = parseCounterBody('{"value":100}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(100);
    expect(result!.unit).toBeUndefined();
    expect(result!.previous).toBeUndefined();
  });

  test("returns null for malformed JSON", () => {
    expect(parseCounterBody("{not valid json}")).toBeNull();
    expect(parseCounterBody("{{}}")).toBeNull();
    expect(parseCounterBody("{value: 42}")).toBeNull(); // unquoted key
  });

  test("returns null when value key is missing", () => {
    expect(parseCounterBody('{"unit":"%","previous":10}')).toBeNull();
    expect(parseCounterBody('{"count":42}')).toBeNull();
    expect(parseCounterBody("{}")).toBeNull();
  });

  test("returns null for JSON array", () => {
    expect(parseCounterBody("[1,2,3]")).toBeNull();
  });

  test("parses body with value=0 (falsy but present)", () => {
    const result = parseCounterBody('{"value":0}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(0);
  });

  test("parses body with value=false (falsy but present)", () => {
    const result = parseCounterBody('{"value":false}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(false);
  });

  test("parses body with value=null (present but null)", () => {
    const result = parseCounterBody('{"value":null}');
    expect(result).not.toBeNull();
    expect(result!.value).toBeNull();
  });

});
