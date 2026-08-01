import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import {
  assignAdapterNames,
  formatImportSummary,
  formatImportUsage,
  formatImportWarnings,
  generateImportedConfig,
  parseOpml,
  IMPORT_PANELS_PER_ROW,
  IMPORT_ROOT_GROUP_TITLE,
  type OpmlGroup,
  type OpmlParseResult,
} from "./cli-import";
import { parseAndValidateConfig } from "./config";
import { runCli } from "./test/cli-runner";
import { describeWriteFailure } from "./cli-help";
import {
  NOT_OPML_RSS,
  OPML_FLAT,
  OPML_FOLDERS,
  OPML_MANY_FOLDERS,
  OPML_NO_BODY,
  OPML_NO_FEEDS,
} from "./test/opml-fixtures";

describe("parseOpml", () => {
  test("flat export produces a single root group in document order", () => {
    const result = parseOpml(OPML_FLAT, "feeds.opml");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].title).toBe(IMPORT_ROOT_GROUP_TITLE);
    expect(result.groups[0].feeds.map((f) => f.xmlUrl)).toEqual([
      "https://simonwillison.net/atom/everything/",
      "https://jvns.ca/atom.xml",
      "https://martinfowler.com/feed.atom",
    ]);
    expect(result.feedCount).toBe(3);
    expect(result.skippedNoXmlUrl).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  test("title falls back to text attr, then to xmlUrl", () => {
    const result = parseOpml(OPML_FLAT, "feeds.opml");
    const [simon, julia, fowler] = result.groups[0].feeds;
    expect(simon.title).toBe("Simon Willison");
    expect(julia.title).toBe("Julia Evans"); // text attr, no title attr
    expect(fowler.title).toBe("https://martinfowler.com/feed.atom"); // neither
  });

  test("folders group feeds; nested folders join with ' / '", () => {
    const result = parseOpml(OPML_FOLDERS, "feeds.opml");
    expect(result.groups.map((g) => g.title)).toEqual([
      "Science & Tech",
      "Science & Tech / Papers",
      "News",
      IMPORT_ROOT_GROUP_TITLE,
    ]);
    expect(result.groups[1].feeds.map((f) => f.title)).toEqual(["arXiv cs.AI"]);
    expect(result.groups[3].feeds.map((f) => f.title)).toEqual(["Rootless"]);
  });

  test("decodes HTML entities in titles, including double-encoded ones", () => {
    const result = parseOpml(OPML_FOLDERS, "feeds.opml");
    const tech = result.groups[0];
    expect(tech.title).toBe("Science & Tech");
    expect(tech.feeds.map((f) => f.title)).toEqual(["AT&T Blog", "It's FOSS"]);
  });

  test("counts leaf outlines without xmlUrl and keeps first duplicate", () => {
    const result = parseOpml(OPML_FOLDERS, "feeds.opml");
    expect(result.skippedNoXmlUrl).toBe(1); // "Broken entry"
    expect(result.duplicateCount).toBe(1); // att.xml appears twice
    // First occurrence (in Science & Tech) wins; News keeps only The Verge.
    const news = result.groups.find((g) => g.title === "News")!;
    expect(news.feeds.map((f) => f.xmlUrl)).toEqual(["https://example.com/verge.xml"]);
    expect(result.feedCount).toBe(5);
  });

  test("single outline child (non-array XML collapse) still parses", () => {
    const xml = `<opml version="2.0"><body>
      <outline title="Only"><outline title="Solo" xmlUrl="https://example.com/solo.xml"/></outline>
    </body></opml>`;
    const result = parseOpml(xml, "one.opml");
    expect(result.groups).toEqual([
      { title: "Only", feeds: [{ title: "Solo", xmlUrl: "https://example.com/solo.xml" }] },
    ]);
  });

  test("feed outline with children keeps children in the same folder", () => {
    const xml = `<opml version="2.0"><body>
      <outline title="Odd" xmlUrl="https://example.com/odd.xml">
        <outline title="Child" xmlUrl="https://example.com/child.xml"/>
      </outline>
    </body></opml>`;
    const result = parseOpml(xml, "odd.opml");
    expect(result.groups[0].feeds.map((f) => f.xmlUrl)).toEqual([
      "https://example.com/odd.xml",
      "https://example.com/child.xml",
    ]);
  });

  test("non-OPML XML fails with a clear diagnostic", () => {
    expect(() => parseOpml(NOT_OPML_RSS, "feed.xml")).toThrow(
      "import: feed.xml is not an OPML file (no <opml> root)",
    );
  });

  test("plain text / HTML-ish input fails the same way", () => {
    expect(() => parseOpml("hello, not xml at all", "notes.txt")).toThrow(
      "is not an OPML file",
    );
  });

  test("OPML without a <body> fails with a clear diagnostic", () => {
    expect(() => parseOpml(OPML_NO_BODY, "empty.opml")).toThrow(
      "import: empty.opml is not an OPML file (missing <body>)",
    );
  });

  test("OPML with no xmlUrl anywhere fails with a clear diagnostic", () => {
    expect(() => parseOpml(OPML_NO_FEEDS, "none.opml")).toThrow(
      "import: no feeds with an xmlUrl found in none.opml",
    );
  });
});

describe("assignAdapterNames", () => {
  const group = (title: string): OpmlGroup => ({ title, feeds: [] });

  test("slugifies titles and dedupes collisions in order", () => {
    expect(
      assignAdapterNames([
        group("Science & Tech"),
        group("science tech"),
        group("News"),
      ]),
    ).toEqual(["science-tech", "science-tech-2", "news"]);
  });

  test("symbol-only titles fall back to 'feeds'; 'all' is reserved", () => {
    expect(assignAdapterNames([group("***"), group("All")])).toEqual([
      "feeds",
      "all-feeds",
    ]);
  });
});

describe("generateImportedConfig", () => {
  test("generated config passes the real config validation pipeline", () => {
    const result = parseOpml(OPML_FOLDERS, "feeds.opml");
    const yaml = generateImportedConfig(result, "feeds.opml");
    const validated = parseAndValidateConfig({ raw: yaml, usedConfigPath: "gen" });
    expect(validated).not.toBeNull();
    expect(validated!.adapters).toHaveLength(4);
    expect(validated!.adapters.every((a) => a.type === "rss")).toBe(true);
  });

  test("quotes entity-decoded panel titles and comments feed titles", () => {
    const result = parseOpml(OPML_FOLDERS, "feeds.opml");
    const yaml = generateImportedConfig(result, "feeds.opml");
    expect(yaml).toContain('- panel: "Science & Tech"');
    expect(yaml).toContain('- panel: "Science & Tech / Papers"');
    expect(yaml).toContain('- "https://example.com/att.xml" # AT&T Blog');
    expect(yaml).toContain("source: \"science-tech\"");
  });

  test("more than IMPORT_PANELS_PER_ROW groups produce a column of rows", () => {
    const result = parseOpml(OPML_MANY_FOLDERS, "many.opml");
    expect(result.groups.length).toBeGreaterThan(IMPORT_PANELS_PER_ROW);
    const yaml = generateImportedConfig(result, "many.opml");
    expect(yaml).toContain("  direction: column");
    expect(yaml.match(/- direction: row/g)).toHaveLength(2); // 5 panels -> 2 rows
    const validated = parseAndValidateConfig({ raw: yaml, usedConfigPath: "gen" });
    expect(validated).not.toBeNull();
  });

  test("single-group import stays a simple row layout", () => {
    const result = parseOpml(OPML_FLAT, "feeds.opml");
    const yaml = generateImportedConfig(result, "feeds.opml");
    expect(yaml).toContain("  direction: row");
    expect(yaml).not.toContain("direction: column");
    expect(parseAndValidateConfig({ raw: yaml, usedConfigPath: "gen" })).not.toBeNull();
  });

  test("hostile titles cannot break YAML quoting", () => {
    const result: OpmlParseResult = {
      groups: [
        {
          title: 'x: "y"\n  - z',
          feeds: [{ title: "a # not a comment: 'b'", xmlUrl: "https://example.com/f.xml" }],
        },
      ],
      feedCount: 1,
      skippedNoXmlUrl: 0,
      duplicateCount: 0,
    };
    const yaml = generateImportedConfig(result, "hostile.opml");
    const validated = parseAndValidateConfig({ raw: yaml, usedConfigPath: "gen" });
    expect(validated).not.toBeNull();
    expect(validated!.adapters).toHaveLength(1);
  });
});

describe("import format helpers", () => {
  const base: OpmlParseResult = {
    groups: [{ title: "Feeds", feeds: [] }],
    feedCount: 1,
    skippedNoXmlUrl: 0,
    duplicateCount: 0,
  };

  test("formatImportWarnings is empty for a clean import", () => {
    expect(formatImportWarnings(base)).toEqual([]);
  });

  test("formatImportWarnings pluralizes skipped and duplicate counts", () => {
    expect(formatImportWarnings({ ...base, skippedNoXmlUrl: 1, duplicateCount: 2 })).toEqual([
      "import: skipped 1 outline without an xmlUrl",
      "import: skipped 2 duplicate feeds",
    ]);
  });

  test("formatImportSummary counts feeds, folders, adapters, panels", () => {
    expect(formatImportSummary(base)).toBe("1 feed in 1 folder -> 1 adapters, 1 panels");
    const many = parseOpml(OPML_FOLDERS, "feeds.opml");
    expect(formatImportSummary(many)).toBe("5 feeds in 4 folders -> 4 adapters, 4 panels");
  });

  test("usage mentions both stdout and file output", () => {
    const usage = formatImportUsage();
    expect(usage).toContain("Usage: pace import <feeds.opml> [output.yaml]");
    expect(usage).toContain("stdout");
    expect(usage).toContain("pace config check");
  });
});

describe("pace import CLI", () => {
  function withTempDir(fn: (dir: string) => void): void {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-import-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("prints generated YAML to stdout with summary on stderr", () => {
    withTempDir((dir) => {
      const opmlPath = join(dir, "feeds.opml");
      writeFileSync(opmlPath, OPML_FLAT);
      const result = runCli(["import", opmlPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("adapters:");
      expect(result.stdout).toContain("type: rss");
      expect(result.stdout).toContain("https://jvns.ca/atom.xml");
      expect(result.stderr).toContain("import: 3 feeds in 1 folder -> 1 adapters, 1 panels");
    });
  });

  test("writes to [output.yaml] and the file passes `pace config check`", () => {
    withTempDir((dir) => {
      const opmlPath = join(dir, "feeds.opml");
      const outPath = join(dir, "config.yaml");
      writeFileSync(opmlPath, OPML_FOLDERS);
      const imported = runCli(["import", opmlPath, outPath]);
      expect(imported.status).toBe(0);
      expect(imported.stdout).toContain(`wrote 5 feeds in 4 folders`);
      expect(imported.stdout).toContain(outPath);
      expect(imported.stderr).toContain("import: skipped 1 outline without an xmlUrl");
      expect(imported.stderr).toContain("import: skipped 1 duplicate feed");

      const checked = runCli(["config", "check", outPath]);
      expect(checked.status).toBe(0);
      expect(checked.stdout).toContain("config OK: 4 adapters, 0 pipelines, 4 panels");
    });
  });

  test("non-OPML input exits 1 with the diagnostic on stderr", () => {
    withTempDir((dir) => {
      const path = join(dir, "feed.xml");
      writeFileSync(path, NOT_OPML_RSS);
      const result = runCli(["import", path]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`import: ${path} is not an OPML file (no <opml> root)`);
      expect(result.stdout).toBe("");
    });
  });

  test("missing input file exits 1 with a read error", () => {
    const result = runCli(["import", "/nonexistent/pace-import.opml"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "import: cannot read /nonexistent/pace-import.opml (not found or not a regular file)",
    );
  });

  test("missing argument and extra arguments show usage", () => {
    const missing = runCli(["import"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Missing OPML file argument");
    expect(missing.stdout).toContain("Usage: pace import");

    const extra = runCli(["import", "a.opml", "b.yaml", "c"]);
    expect(extra.status).toBe(1);
    expect(extra.stderr).toContain("Unknown argument: c");
  });

  test("serve/share-only options are rejected", () => {
    const result = runCli(["import", "--port", "1234", "a.opml"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option(s) for this command: --port");
  });

  test("--help lists the import command", () => {
    const result = runCli(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      "import <feeds.opml>      Convert an OPML feed export to a pace config",
    );
  });
});

describe("describeWriteFailure", () => {
  test("drops the errno syscall suffix when it repeats the target path", () => {
    const err = new Error("ENOENT: no such file or directory, open '/nonexistent-dir/out.yaml'");
    expect(describeWriteFailure(err, "/nonexistent-dir/out.yaml")).toBe(
      "ENOENT: no such file or directory",
    );
  });

  test("keeps the suffix when the syscall path differs from the target", () => {
    const err = new Error("ENOENT: no such file or directory, open '/other/file.yaml'");
    expect(describeWriteFailure(err, "/nonexistent-dir/out.yaml")).toBe(
      "ENOENT: no such file or directory, open '/other/file.yaml'",
    );
  });

  test("passes non-errno messages through unchanged", () => {
    expect(describeWriteFailure(new Error("disk on fire"), "/out.yaml")).toBe("disk on fire");
  });

  test("CLI write failure reports the path once, without the raw syscall echo", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-import-write-"));
    try {
      const opmlPath = join(dir, "feeds.opml");
      writeFileSync(
        opmlPath,
        '<opml version="1.0"><body><outline text="A" xmlUrl="https://example.com/f.xml"/></body></opml>',
      );
      const outPath = join(dir, "no-such-subdir", "out.yaml");
      const result = runCli(["import", opmlPath, outPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(`import: cannot write ${outPath}: ENOENT: no such file or directory`);
      expect(result.stderr).not.toContain(`open '${outPath}'`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
