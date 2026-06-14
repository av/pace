import { describe, test, expect, spyOn, beforeEach, afterEach, mock } from "bun:test";
import { resolveJsonPath, parseJsonPath, interpolateEnvVars } from "./adapters/counter";
import adapter from "./adapters/counter";
import type { AdapterConfig } from "./adapters/types";
import { abbreviateNumber, parseCounterBody } from "./layout/counter-panel";

describe("counter adapter", () => {
  describe("resolveJsonPath", () => {
    test("resolves simple dot notation", () => {
      const obj = { foo: { bar: { baz: 42 } } };
      expect(resolveJsonPath(obj, "foo.bar.baz")).toBe(42);
    });

    test("resolves top-level key", () => {
      const obj = { stargazers_count: 12345 };
      expect(resolveJsonPath(obj, "stargazers_count")).toBe(12345);
    });

    test("resolves bracket array access", () => {
      const obj = { data: [10, 20, 30] };
      expect(resolveJsonPath(obj, "data[1]")).toBe(20);
    });

    test("resolves mixed dot and bracket notation", () => {
      const obj = { data: { metrics: [{ value: 99 }] } };
      expect(resolveJsonPath(obj, "data.metrics[0].value")).toBe(99);
    });

    test("resolves nested array access", () => {
      const obj = { a: [[1, 2], [3, 4]] };
      expect(resolveJsonPath(obj, "a[1][0]")).toBe(3);
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

    test("resolves boolean values", () => {
      const obj = { active: true };
      expect(resolveJsonPath(obj, "active")).toBe(true);
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

    test("resolves deeply nested path (10+ levels)", () => {
      let deep: unknown = 99;
      for (let i = 9; i >= 0; i--) {
        deep = { [`L${i}`]: deep };
      }
      const path = Array.from({ length: 10 }, (_, i) => `L${i}`).join(".");
      expect(resolveJsonPath(deep, path)).toBe(99);
    });

    test("resolves array of arrays", () => {
      const obj = { matrix: [[1, 2], [3, 4], [5, 6]] };
      expect(resolveJsonPath(obj, "matrix[2][0]")).toBe(5);
    });

    test("resolves value from root array via named key", () => {
      // Root arrays require a named key before bracket access
      // e.g., { results: [{ value: 42 }] }
      const obj = { results: [{ value: 42 }] };
      expect(resolveJsonPath(obj, "results[0].value")).toBe(42);
    });
  });

  describe("parseJsonPath", () => {
    test("parses simple dot notation", () => {
      expect(parseJsonPath("foo.bar.baz")).toEqual(["foo", "bar", "baz"]);
    });

    test("parses bracket notation", () => {
      expect(parseJsonPath("arr[0]")).toEqual(["arr", 0]);
    });

    test("parses mixed notation", () => {
      expect(parseJsonPath("data.metrics[0].value")).toEqual(["data", "metrics", 0, "value"]);
    });

    test("parses single key", () => {
      expect(parseJsonPath("count")).toEqual(["count"]);
    });

    test("throws on malformed bracket (unclosed)", () => {
      expect(() => parseJsonPath("arr[0")).toThrow(/unclosed bracket/);
    });

    test("throws on invalid array index", () => {
      expect(() => parseJsonPath("arr[-1]")).toThrow(/invalid array index/);
    });

    test("parses deeply nested path (10+ levels)", () => {
      const path = "a.b.c.d.e.f.g.h.i.j.k";
      expect(parseJsonPath(path)).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"]);
    });

    test("parses consecutive bracket notation", () => {
      expect(parseJsonPath("matrix[0][1]")).toEqual(["matrix", 0, 1]);
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

    test("interpolates multiple env vars", () => {
      process.env.TEST_HOST = "example.com";
      process.env.TEST_PORT = "8080";
      expect(interpolateEnvVars("${TEST_HOST}:${TEST_PORT}")).toBe("example.com:8080");
    });

    test("replaces missing env vars with empty string", () => {
      expect(interpolateEnvVars("key=${DEFINITELY_NOT_SET_COUNTER_TEST}")).toBe("key=");
    });

    test("returns string unchanged when no env vars", () => {
      expect(interpolateEnvVars("plain string")).toBe("plain string");
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

    test("adapter name is counter", () => {
      expect(adapter.name).toBe("counter");
    });

    test("returns one ContentItem with correct mapping", async () => {
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
      expect(result).toHaveLength(1);

      const item = result[0];
      expect(item.title).toBe("Stars");
      expect(item.url).toBe("");
      expect(item.id).toMatch(/^counter:counter:\d+$/);

      const body = JSON.parse(item.body!);
      expect(body.value).toBe(42000);
      expect(body.unit).toBe("k");
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

    test("includes previous value from compare_url", async () => {
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
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(50);
      expect(body.previous).toBe(38);
    });

    test("continues without previous when compare_url fails", async () => {
      fetchSpy = spyOn(globalThis, "fetch")
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ value: 100 }), { status: 200 }),
        )
        .mockRejectedValueOnce(new Error("network error"));

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "value",
          compare_url: "https://example.com/api?old",
        },
      };

      const result = await adapter.fetch(config);
      expect(result).toHaveLength(1);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(100);
      expect(body.previous).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
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

    test("stores non-numeric values as-is", async () => {
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
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe("UP");
    });

    test("uses json_path as default compare_path", async () => {
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
          // no compare_path - should default to json_path
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.previous).toBe(4.8);
    });

    test("omits unit from body when not specified", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ count: 7 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "count",
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.unit).toBeUndefined();
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

    test("resolves JSON path through arrays", async () => {
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
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(777);
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

    test("handles very large numbers", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ big: 999999999999 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "big",
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(999999999999);
    });

    test("handles negative numbers", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ delta: -42 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "delta",
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(-42);
    });

    test("handles floating point values", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ pi: 3.14159 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "pi",
        },
      };

      const result = await adapter.fetch(config);
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(3.14159);
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

    test("handles boolean value at path", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ healthy: true }), { status: 200 }),
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
      expect(body.value).toBe(true);
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

    test("no trend when compare_url returns same value as url", async () => {
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
      const body = JSON.parse(result[0].body!);
      expect(body.value).toBe(500);
      expect(body.previous).toBe(500);
      // value === previous means no change / no trend
    });

    test("headers with missing env vars resolve to empty strings", async () => {
      fetchSpy = spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify({ val: 1 }), { status: 200 }),
      );

      const config: AdapterConfig = {
        type: "counter",
        params: {
          url: "https://example.com/api",
          json_path: "val",
          headers: {
            Authorization: "Bearer ${NONEXISTENT_COUNTER_TEST_VAR}",
          },
        },
      };

      const result = await adapter.fetch(config);
      expect(result).toHaveLength(1);

      // Verify the header was sent with the env var resolved to empty string
      const fetchCall = fetchSpy.mock.calls[0];
      const sentHeaders = fetchCall[1]?.headers as Record<string, string>;
      expect(sentHeaders.Authorization).toBe("Bearer ");
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

  test("accepts counter adapter with compare_url on localhost", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      compare_url: http://localhost:3000/api/previous
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

  test("rejects compare_path with constructor segment", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://example.com/api
      json_path: value
      compare_url: https://example.com/api?old
      compare_path: data.constructor
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

  test("returns null for null input", () => {
    expect(parseCounterBody(null)).toBeNull();
  });

  test("returns null for undefined input", () => {
    expect(parseCounterBody(undefined)).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(parseCounterBody("")).toBeNull();
  });

  test("returns null for JSON array", () => {
    expect(parseCounterBody("[1,2,3]")).toBeNull();
  });

  test("returns null for JSON primitive string", () => {
    expect(parseCounterBody('"hello"')).toBeNull();
  });

  test("returns null for JSON primitive number", () => {
    expect(parseCounterBody("42")).toBeNull();
  });

  test("returns null for JSON null literal", () => {
    expect(parseCounterBody("null")).toBeNull();
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

  test("parses body with string value", () => {
    const result = parseCounterBody('{"value":"UP"}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe("UP");
  });

  test("handles very large JSON body", () => {
    const bigObj = { value: 999, extra: "x".repeat(10000) };
    const result = parseCounterBody(JSON.stringify(bigObj));
    expect(result).not.toBeNull();
    expect(result!.value).toBe(999);
  });

  test("handles unicode in body", () => {
    const result = parseCounterBody('{"value":42,"unit":"\\u00b0C"}');
    expect(result).not.toBeNull();
    expect(result!.unit).toBe("°C");
  });

  test("handles nested objects in value", () => {
    const result = parseCounterBody('{"value":{"nested":true}}');
    expect(result).not.toBeNull();
    expect(result!.value).toEqual({ nested: true });
  });
});
