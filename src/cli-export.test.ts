import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  collectExportFeeds,
  formatExportSummary,
  formatExportUsage,
  formatExportWarnings,
  generateOpml,
} from "./cli-export";
import { parseOpml } from "./cli-import";
import { runCli } from "./test/cli-runner";
import type { AppConfig } from "./config/types";

function appConfig(adapters: AppConfig["adapters"]): AppConfig {
  return { adapters, layout: { direction: "row", children: [] } };
}

describe("collectExportFeeds", () => {
  test("collects rss urls into one group per adapter, titled by adapter name", () => {
    const result = collectExportFeeds(
      appConfig([
        { name: "tech", type: "rss", params: { urls: ["https://a.com/rss", "https://b.com/rss"] } },
        { name: "pods", type: "podcast", params: { feeds: ["https://c.com/pod.rss"] } },
      ]),
    );
    expect(result.groups).toEqual([
      {
        title: "tech",
        feeds: [
          { title: "https://a.com/rss", xmlUrl: "https://a.com/rss" },
          { title: "https://b.com/rss", xmlUrl: "https://b.com/rss" },
        ],
      },
      { title: "pods", feeds: [{ title: "https://c.com/pod.rss", xmlUrl: "https://c.com/pod.rss" }] },
    ]);
    expect(result.feedCount).toBe(3);
    expect(result.duplicateCount).toBe(0);
    expect(result.skippedAdapters).toEqual([]);
  });

  test("falls back to adapter type when name is missing", () => {
    const result = collectExportFeeds(
      appConfig([{ type: "rss", params: { urls: ["https://a.com/rss"] } }]),
    );
    expect(result.groups[0].title).toBe("rss");
  });

  test("skips non-feed adapters and reports them", () => {
    const result = collectExportFeeds(
      appConfig([
        { name: "hn", type: "hackernews", params: {} },
        { name: "tech", type: "rss", params: { urls: ["https://a.com/rss"] } },
      ]),
    );
    expect(result.skippedAdapters).toEqual(["hn"]);
    expect(result.feedCount).toBe(1);
  });

  test("skips feed adapters with no usable urls and reports them", () => {
    const result = collectExportFeeds(
      appConfig([
        { name: "empty", type: "rss", params: { urls: ["", "   "] } },
        { name: "tech", type: "rss", params: { urls: ["https://a.com/rss"] } },
      ]),
    );
    expect(result.skippedAdapters).toEqual(["empty"]);
    expect(result.groups.map((g) => g.title)).toEqual(["tech"]);
  });

  test("dedupes urls across adapters, keeping the first occurrence", () => {
    const result = collectExportFeeds(
      appConfig([
        { name: "one", type: "rss", params: { urls: ["https://a.com/rss"] } },
        { name: "two", type: "rss", params: { urls: ["https://a.com/rss", "https://b.com/rss"] } },
      ]),
    );
    expect(result.duplicateCount).toBe(1);
    expect(result.feedCount).toBe(2);
    expect(result.groups[1].feeds).toEqual([
      { title: "https://b.com/rss", xmlUrl: "https://b.com/rss" },
    ]);
  });

  test("throws when the config has no feed urls at all", () => {
    expect(() => collectExportFeeds(appConfig([{ name: "hn", type: "hackernews" }]))).toThrow(
      "export: no rss or podcast feed URLs found in config",
    );
  });
});

describe("generateOpml", () => {
  const result = collectExportFeeds(
    appConfig([
      { name: "tech & news", type: "rss", params: { urls: ["https://a.com/rss?x=1&y=2"] } },
    ]),
  );

  test("emits OPML 2.0 with escaped attributes", () => {
    const xml = generateOpml(result, "config.yaml");
    expect(xml).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain("<title>pace feeds from config.yaml</title>");
    expect(xml).toContain('text="tech &amp; news"');
    expect(xml).toContain('xmlUrl="https://a.com/rss?x=1&amp;y=2"');
  });

  test("round-trips through parseOpml with the same groups and urls", () => {
    const multi = collectExportFeeds(
      appConfig([
        { name: "tech", type: "rss", params: { urls: ["https://a.com/rss", "https://b.com/rss"] } },
        { name: "pods", type: "podcast", params: { feeds: ["https://c.com/pod.rss"] } },
      ]),
    );
    const parsed = parseOpml(generateOpml(multi, "config.yaml"), "roundtrip");
    expect(parsed.feedCount).toBe(3);
    expect(parsed.groups.map((g) => g.title)).toEqual(["tech", "pods"]);
    expect(parsed.groups[0].feeds.map((f) => f.xmlUrl)).toEqual([
      "https://a.com/rss",
      "https://b.com/rss",
    ]);
    expect(parsed.skippedNoXmlUrl).toBe(0);
    expect(parsed.duplicateCount).toBe(0);
  });
});

describe("export formatting", () => {
  test("summary pluralizes feeds and adapters", () => {
    const one = collectExportFeeds(
      appConfig([{ name: "tech", type: "rss", params: { urls: ["https://a.com/rss"] } }]),
    );
    expect(formatExportSummary(one)).toBe("1 feed from 1 adapter");
  });

  test("warnings cover skipped adapters and duplicates; empty when clean", () => {
    const clean = collectExportFeeds(
      appConfig([{ name: "tech", type: "rss", params: { urls: ["https://a.com/rss"] } }]),
    );
    expect(formatExportWarnings(clean)).toEqual([]);

    const messy = collectExportFeeds(
      appConfig([
        { name: "hn", type: "hackernews" },
        { name: "one", type: "rss", params: { urls: ["https://a.com/rss"] } },
        { name: "two", type: "rss", params: { urls: ["https://a.com/rss", "https://b.com/rss"] } },
      ]),
    );
    expect(formatExportWarnings(messy)).toEqual([
      "export: skipped 1 adapter without feed URLs (hn)",
      "export: skipped 1 duplicate feed",
    ]);
  });

  test("usage names the command and its options", () => {
    const usage = formatExportUsage();
    expect(usage).toContain("Usage: pace export [output.opml]");
    expect(usage).toContain("--config");
    expect(usage).toContain("--preset");
  });
});

describe("pace export CLI", () => {
  const CONFIG = `adapters:
  - name: tech
    type: rss
    params:
      urls:
        - "https://a.com/rss"
        - "https://b.com/rss"
  - name: hn
    type: hackernews
layout:
  direction: row
  children:
    - panel: Tech
      source: tech
`;

  function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-export-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("prints OPML to stdout with summary and warnings on stderr", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "config.yaml"), CONFIG);
      const res = runCli(["export", "--config", join(dir, "config.yaml")]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain('<opml version="2.0">');
      expect(res.stdout).toContain('xmlUrl="https://a.com/rss"');
      expect(res.stderr).toContain("export: skipped 1 adapter without feed URLs (hn)");
      expect(res.stderr).toContain("export: 2 feeds from 1 adapter");
    });
  });

  test("writes to a file when given an output path", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "config.yaml"), CONFIG);
      const out = join(dir, "feeds.opml");
      const res = runCli(["export", "--config", join(dir, "config.yaml"), out]);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain(`export: wrote 2 feeds from 1 adapter to ${out}`);
      const parsed = parseOpml(readFileSync(out, "utf8"), out);
      expect(parsed.feedCount).toBe(2);
    });
  });

  test("output round-trips through pace import", () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, "config.yaml"), CONFIG);
      const out = join(dir, "feeds.opml");
      expect(runCli(["export", "--config", join(dir, "config.yaml"), out]).status).toBe(0);
      const imported = runCli(["import", out]);
      expect(imported.status).toBe(0);
      expect(imported.stdout).toContain('- "https://a.com/rss"');
      expect(imported.stderr).toContain("import: 2 feeds in 1 folder -> 1 adapters, 1 panels");
    });
  });

  test("fails with a clear error when the config has no feed urls", () => {
    withTempDir((dir) => {
      writeFileSync(
        join(dir, "config.yaml"),
        `adapters:
  - name: hn
    type: hackernews
layout:
  direction: row
  children:
    - panel: HN
      source: hn
`,
      );
      const res = runCli(["export", "--config", join(dir, "config.yaml")]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("export: no rss or podcast feed URLs found in config");
    });
  });

  test("rejects extra positional arguments", () => {
    const res = runCli(["export", "a.opml", "b.opml"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown argument: b.opml");
  });

  test("rejects serve-only options", () => {
    const res = runCli(["export", "--port", "8080"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s) for this command: --port");
  });

  test("help lists the export command", () => {
    const res = runCli(["--help"]);
    expect(res.stdout).toContain("export [output.opml]     Export configured feed URLs as OPML");
  });
});
