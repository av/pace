import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  runDoctor,
  formatDoctorReport,
  formatDoctorUsage,
  DOCTOR_DEFAULT_TIMEOUT_MS,
  DOCTOR_CONCURRENCY,
  type DoctorReport,
} from "./cli-doctor";
import { runCli } from "./test/cli-runner";
import type { Adapter, ContentItem } from "./adapters/types";
import type { AppConfig } from "./config/types";

function item(id: string): ContentItem {
  return {
    id,
    title: `title ${id}`,
    url: `https://example.com/${id}`,
    source: "test",
    timestamp: new Date("2026-08-01T00:00:00Z"),
  };
}

function fakeAdapter(fetch: Adapter["fetch"], name = "fake"): Adapter {
  return { name, fetch };
}

function appConfig(adapters: AppConfig["adapters"]): AppConfig {
  return { adapters, layout: { direction: "row", children: [] } };
}

describe("runDoctor", () => {
  test("empty config yields empty ok report", async () => {
    const report = await runDoctor(appConfig([]), new Map());
    expect(report.ok).toBe(true);
    expect(report.results).toEqual([]);
  });

  test("successful fetch reports ok with item count and duration", async () => {
    const adapters = new Map([["good", fakeAdapter(async () => [item("a"), item("b")])]]);
    const report = await runDoctor(appConfig([{ type: "good" }]), adapters);
    expect(report.ok).toBe(true);
    expect(report.results).toHaveLength(1);
    const result = report.results[0];
    expect(result.name).toBe("good");
    expect(result.type).toBe("good");
    expect(result.ok).toBe(true);
    expect(result.itemCount).toBe(2);
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("failing fetch reports the adapter's diagnosable error message", async () => {
    const adapters = new Map([
      [
        "bad",
        fakeAdapter(async () => {
          throw new Error("bad: fetch https://x.test/feed failed: HTTP 404 Not Found");
        }),
      ],
    ]);
    const report = await runDoctor(appConfig([{ type: "bad" }]), adapters);
    expect(report.ok).toBe(false);
    const result = report.results[0];
    expect(result.ok).toBe(false);
    expect(result.itemCount).toBeUndefined();
    expect(result.error).toBe("bad: fetch https://x.test/feed failed: HTTP 404 Not Found");
  });

  test("unknown adapter type fails with a pointer to `pace adapters list`", async () => {
    const report = await runDoctor(appConfig([{ type: "nope" }]), new Map());
    expect(report.ok).toBe(false);
    const result = report.results[0];
    expect(result.error).toContain('unknown adapter type "nope"');
    expect(result.error).toContain("pace adapters list");
  });

  test("hung fetch fails with timeout message instead of hanging", async () => {
    const adapters = new Map([
      ["hang", fakeAdapter(() => new Promise<ContentItem[]>(() => {}))],
    ]);
    const report = await runDoctor(appConfig([{ type: "hang" }]), adapters, {
      timeoutMs: 25,
    });
    expect(report.ok).toBe(false);
    expect(report.results[0].error).toBe("timed out after 25ms");
  });

  test("results preserve config order regardless of completion order", async () => {
    const adapters = new Map<string, Adapter>([
      [
        "slow",
        fakeAdapter(
          () => new Promise((resolve) => setTimeout(() => resolve([item("s")]), 40)),
        ),
      ],
      ["fast", fakeAdapter(async () => [item("f")])],
    ]);
    const report = await runDoctor(
      appConfig([
        { type: "slow", name: "first" },
        { type: "fast", name: "second" },
        { type: "fast", name: "third" },
      ]),
      adapters,
    );
    expect(report.results.map((r) => r.name)).toEqual(["first", "second", "third"]);
    expect(report.ok).toBe(true);
  });

  test("named sources use their config name; unnamed fall back to type", async () => {
    const adapters = new Map([["rss-like", fakeAdapter(async () => [])]]);
    const report = await runDoctor(
      appConfig([{ type: "rss-like", name: "my blog" }, { type: "rss-like" }]),
      adapters,
    );
    expect(report.results[0].name).toBe("my blog");
    expect(report.results[1].name).toBe("rss-like");
  });

  test("one failure among successes marks the report not ok", async () => {
    const adapters = new Map<string, Adapter>([
      ["ok1", fakeAdapter(async () => [item("1")])],
      [
        "broken",
        fakeAdapter(async () => {
          throw new Error("broken: connection refused");
        }),
      ],
    ]);
    const report = await runDoctor(
      appConfig([{ type: "ok1" }, { type: "broken" }, { type: "ok1", name: "again" }]),
      adapters,
    );
    expect(report.ok).toBe(false);
    expect(report.results.map((r) => r.ok)).toEqual([true, false, true]);
  });

  test("concurrency is bounded", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const adapters = new Map([
      [
        "counted",
        fakeAdapter(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 10));
          inFlight--;
          return [];
        }),
      ],
    ]);
    const sources = Array.from({ length: 8 }, (_, i) => ({
      type: "counted",
      name: `s${i}`,
    }));
    await runDoctor(appConfig(sources), adapters, { concurrency: 2 });
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test("default budget constants are sane", () => {
    expect(DOCTOR_DEFAULT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(DOCTOR_CONCURRENCY).toBeGreaterThan(0);
  });
});

describe("formatDoctorReport", () => {
  test("no sources", () => {
    expect(formatDoctorReport({ results: [], ok: true })).toBe(
      "doctor: no sources configured",
    );
  });

  test("all-ok report lists counts, durations, and summary", () => {
    const report: DoctorReport = {
      ok: true,
      results: [
        { name: "hn", type: "hackernews", ok: true, itemCount: 30, durationMs: 512 },
        { name: "rss", type: "rss", ok: true, itemCount: 1, durationMs: 88 },
      ],
    };
    const text = formatDoctorReport(report);
    expect(text).toContain("ok    hn (hackernews)  30 items in 512ms");
    // "rss" is padded to the widest label ("hn (hackernews)", 15 chars)
    expect(text).toContain(`ok    ${"rss".padEnd(15)}  1 item in 88ms`);
    expect(text.endsWith("all 2 sources ok")).toBe(true);
  });

  test("failures show FAIL with the error message and failure summary", () => {
    const report: DoctorReport = {
      ok: false,
      results: [
        { name: "good", type: "rss", ok: true, itemCount: 5, durationMs: 100 },
        {
          name: "dead",
          type: "rss",
          ok: false,
          durationMs: 30,
          error: "rss: fetch https://dead.test/ failed: connection refused",
        },
      ],
    };
    const text = formatDoctorReport(report);
    expect(text).toContain(
      "FAIL  dead (rss)  rss: fetch https://dead.test/ failed: connection refused",
    );
    expect(text.endsWith("1 ok, 1 failed (2 sources)")).toBe(true);
  });

  test("single source uses singular noun", () => {
    const report: DoctorReport = {
      ok: true,
      results: [{ name: "only", type: "rss", ok: true, itemCount: 0, durationMs: 5 }],
    };
    expect(formatDoctorReport(report).endsWith("all 1 source ok")).toBe(true);
  });

  test("usage names the command and exit semantics", () => {
    const usage = formatDoctorUsage();
    expect(usage).toContain("Usage: pace doctor");
    expect(usage).toContain("Exit status: 0");
  });
});

describe("pace doctor (CLI)", () => {
  function withTempConfig(yaml: string, fn: (path: string) => void): void {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-doctor-"));
    try {
      const path = join(dir, "config.yaml");
      writeFileSync(path, yaml);
      fn(path);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("exits 0 and reports ok for declarative (offline) sources", () => {
    withTempConfig(
      `adapters:
  - type: bookmarks
    name: links
    params:
      items:
        - title: Example
          url: https://example.com
layout:
  direction: row
  children:
    - panel: Links
      source: links
`,
      (path) => {
        const result = runCli(["doctor", "--config", path]);
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("ok    links (bookmarks)");
        expect(result.stdout).toContain("all 1 source ok");
      },
    );
  });

  test("exits 1 and reports FAIL for an unreachable source", () => {
    // 127.0.0.1:1 - binding port 1 needs root, so the connection is refused
    // locally without touching the network.
    withTempConfig(
      `adapters:
  - type: bookmarks
    name: links
    params:
      items:
        - title: Example
          url: https://example.com
  - type: rss
    name: dead feed
    params:
      urls:
        - http://127.0.0.1:1/feed.xml
layout:
  direction: row
  children:
    - panel: Links
      source: all
`,
      (path) => {
        const result = runCli(["doctor", "--config", path]);
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("ok    links (bookmarks)");
        expect(result.stdout).toContain("FAIL  dead feed (rss)");
        expect(result.stdout).toContain("1 ok, 1 failed (2 sources)");
      },
    );
  });

  test("missing explicit config exits 1 with config error", () => {
    const result = runCli(["doctor", "--config", "/nonexistent/pace-doctor.yaml"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("config");
  });

  test("rejects unknown arguments and serve-only options", () => {
    const positional = runCli(["doctor", "bogus"]);
    expect(positional.status).toBe(1);
    expect(positional.stderr).toContain("Unknown argument: bogus");

    const option = runCli(["doctor", "--port", "1234"]);
    expect(option.status).toBe(1);
    expect(option.stderr).toContain("Unknown option(s) for this command: --port");
  });

  test("help lists the doctor command", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("doctor                   Fetch-check every configured source");
  });
});
