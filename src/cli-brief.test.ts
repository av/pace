import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveItems } from "./db";
import { formatBriefUsage, runBriefCli } from "./cli-brief";
import { buildBriefConfigInfo } from "./brief";
import { loadConfig } from "./config";
import { makeContentItem } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";
import {
  createTestServerApp,
  makeServerRouteDeps,
  requestServerRoute,
} from "./test/server-harness";

installTempDbHooks({ prefix: "pace-cli-brief-" });

const CONFIG_YAML = `adapters:
  - name: hn
    type: hackernews
  - name: links
    type: bookmarks
    params:
      items:
        - title: Example
          url: https://example.com
layout:
  direction: row
  children:
    - panel: Tech
      id: tech-panel
      source: hn
    - panel: Links
      id: links-panel
      source: links
`;

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pace-cli-brief-cfg-"));
  configPath = join(dir, "dash.yaml");
  writeFileSync(configPath, CONFIG_YAML);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function seed() {
  const recent = new Date(Date.now() - 3_600_000);
  saveItems("tech-panel", [
    makeContentItem({ id: "t1", title: "First tech story about models", url: "https://ex.com/t1", body: "90 points | by a | 12 comments", timestamp: recent }),
    makeContentItem({ id: "t2", title: "Second tech story about agents", url: "https://ex.com/t2", body: "10 points | by b | 1 comments", timestamp: recent }),
  ]);
  saveItems("links-panel", [makeContentItem({ id: "l1", title: "A bookmark", url: "https://ex.com/l1", timestamp: recent })]);
}

function runBrief(args: string[]) {
  return spawnSync(process.execPath, [join(process.cwd(), "src/cli.ts"), "brief", ...args], {
    encoding: "utf8" as const,
    stdio: "pipe" as const,
    env: { ...process.env },
  });
}

describe("formatBriefUsage", () => {
  test("documents formats, filters and the schema doc", () => {
    const usage = formatBriefUsage();
    for (const flag of ["--json", "--md", "--panel", "--since", "--limit", "--per-panel", "--config", "--preset", "--chdir"]) {
      expect(usage).toContain(flag);
    }
    expect(usage).toContain("docs/brief.md");
    expect(usage).toContain("/api/brief");
    expect(usage).toContain("/brief.md");
  });
});

describe("pace brief CLI", () => {
  test("prints Markdown by default with a brief: summary on stderr", () => {
    seed();
    const res = runBrief(["-c", configPath]);
    expect(res.status).toBe(0);
    expect(res.stderr).toContain("brief: 2 items from 1 panel, about ");
    expect(res.stderr).toContain("(markdown)");
    expect(res.stdout.startsWith("# Pace brief: dash.yaml\n")).toBe(true);
    expect(res.stdout).toContain("- [1] First tech story about models");
    expect(res.stdout).toContain("Skipped reference panels: Links.");
    expect(res.stdout).not.toContain("A bookmark");
  });

  test("--json emits the pace.brief/v1 document; --md is explicit Markdown", () => {
    seed();
    const json = runBrief(["-c", configPath, "--json", "--limit", "1"]);
    expect(json.status).toBe(0);
    const doc = JSON.parse(json.stdout);
    expect(doc.schema).toBe("pace.brief/v1");
    expect(doc.items.map((i: any) => i.id)).toEqual(["t1"]);
    expect(json.stderr).toContain("(json)");
    const md = runBrief(["-c", configPath, "--md", "--panel", "Links", "--since", "all"]);
    expect(md.status).toBe(0);
    expect(md.stdout).toContain("- [1] A bookmark");
  });

  test("--panel repeats, --per-panel caps", () => {
    seed();
    const res = runBrief(["-c", configPath, "--json", "--panel", "Tech", "--panel", "links-panel", "--per-panel", "1"]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout).items.map((i: any) => i.id)).toEqual(["t1", "l1"]);
  });

  test.each([
    [["--json", "--md"], "brief: --json and --md cannot be combined"],
    [["--limit", "0"], "brief: limit must be between 1 and 200"],
    [["--per-panel", "x"], "brief: per_panel must be a positive integer"],
    [["--since", "soon"], "brief: since must be a duration"],
    [["--panel", "nope"], "brief: Unknown panel: nope"],
  ])("rejects %j", (args, message) => {
    const res = runBrief(["-c", configPath, ...(args as string[])]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(message as string);
  });

  test("rejects options that belong to other commands and stray arguments", () => {
    expect(runBrief(["-c", configPath, "--rss"]).status).toBe(1);
    expect(runBrief(["-c", configPath, "extra"]).status).toBe(1);
    expect(runBrief(["-c", configPath, "--panel"]).status).toBe(1);
  });

  test("matches what GET /api/brief serves for the same options", async () => {
    seed();
    process.env.PACE_CONFIG = configPath;
    try {
      const config = loadConfig();
      const cli = JSON.parse(runBriefCli(config, { json: true, since: "24h", limit: "5" }, configPath).output);
      const app = createTestServerApp(
        makeServerRouteDeps({ layout: config.layout, brief: buildBriefConfigInfo(config, "dash.yaml") }),
      );
      const api = (await (await requestServerRoute(app, "/api/brief?since=24h&limit=5")).json()) as any;
      const strip = (doc: any) => doc.items.map((i: any) => [i.n, i.id, i.title, i.url, i.panel, i.summary, i.also_in]);
      expect(strip(cli)).toEqual(strip(api));
      expect(cli.config).toBe(api.config);
      expect(cli.scope.panels).toEqual(api.scope.panels);
      expect(cli.counts).toEqual(api.counts);
    } finally {
      delete process.env.PACE_CONFIG;
    }
  });
});
