import { describe, test, expect, spyOn } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { ADAPTER_TYPES, isAdapterType } from "./adapters/params";
import { TRANSFORM_TYPES } from "./transform-schema";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import { CLI_PARSE_OPTIONS, getCliCommand } from "./cli-help";
import { DEFAULT_REFRESH_INTERVAL_MIN } from "./scheduler-runtime";
import { parsePort } from "./utils";

const ROOT = join(import.meta.dir, "..");
const configSkillPath = join(ROOT, "skills/pace-config/SKILL.md");
const setupSkillPath = join(ROOT, "skills/pace-setup/SKILL.md");
const configSkill = readFileSync(configSkillPath, "utf-8");
const setupSkill = readFileSync(setupSkillPath, "utf-8");

// ---------------------------------------------------------------------------
// Markdown extraction helpers
// ---------------------------------------------------------------------------

interface FencedBlock {
  lang: string;
  content: string;
  heading: string;
}

/** Extract fenced code blocks, remembering the nearest preceding heading. */
function extractFencedBlocks(markdown: string): FencedBlock[] {
  const lines = markdown.split("\n");
  const blocks: FencedBlock[] = [];
  let heading = "(top)";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const h = /^#{1,4}\s+(.+)$/.exec(line);
    if (h) heading = h[1]!;
    const f = /^```(\w*)\s*$/.exec(line);
    if (f) {
      const lang = f[1] ?? "";
      const start = i + 1;
      i = start;
      while (i < lines.length && !/^```\s*$/.test(lines[i]!)) i++;
      blocks.push({ lang, content: lines.slice(start, i).join("\n"), heading });
    }
    i++;
  }
  return blocks;
}

/**
 * Split a YAML block into documents whenever a top-level mapping key repeats.
 * The skill uses side-by-side variants in one fence (e.g. BEFORE/AFTER configs
 * both starting with `adapters:`, or two alternative `llm:` blocks), which is
 * not valid as a single YAML document.
 */
function splitTopLevelDocs(block: string): string[] {
  const docs: string[] = [];
  let current: string[] = [];
  let seen = new Set<string>();
  for (const line of block.split("\n")) {
    const m = /^([A-Za-z_][\w-]*):/.exec(line);
    if (m) {
      if (seen.has(m[1]!)) {
        docs.push(current.join("\n"));
        current = [];
        seen = new Set();
      }
      seen.add(m[1]!);
    }
    current.push(line);
  }
  if (current.join("\n").trim() !== "") docs.push(current.join("\n"));
  return docs;
}

function isRecordObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Turning skill YAML fragments into full validatable configs
// ---------------------------------------------------------------------------

/** Collect every source name referenced by panels/pipelines in a config object. */
function collectSourceRefs(config: Record<string, unknown>): {
  referenced: Set<string>;
  counterSources: Set<string>;
} {
  const referenced = new Set<string>();
  const counterSources = new Set<string>();

  const pipelines = Array.isArray(config.pipelines) ? config.pipelines : [];
  for (const pipeline of pipelines) {
    if (!isRecordObj(pipeline)) continue;
    const sources = Array.isArray(pipeline.sources) ? pipeline.sources : [];
    for (const s of sources) if (typeof s === "string") referenced.add(s);
  }

  function walk(node: unknown): void {
    if (!isRecordObj(node)) return;
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
      return;
    }
    if ("panel" in node && "source" in node) {
      const sources = Array.isArray(node.source) ? node.source : [node.source];
      for (const s of sources) {
        if (typeof s !== "string" || s === "all") continue;
        referenced.add(s);
        if (node.display === "counter") counterSources.add(s);
      }
    }
  }
  walk(config.layout);

  return { referenced, counterSources };
}

/**
 * Wrap a parsed YAML fragment from the skill into a full config object.
 * Fragments come in three shapes: adapter lists, layout-node lists, and
 * top-level config subsets (pipelines/layout/llm/server/transforms).
 */
function fragmentToConfig(parsed: unknown): Record<string, unknown> {
  if (Array.isArray(parsed)) {
    const items = parsed.filter(isRecordObj);
    if (items.length !== parsed.length) {
      throw new Error("list block contains non-object entries");
    }
    if (items.every((it) => "type" in it)) {
      return { adapters: items };
    }
    if (items.every((it) => "panel" in it || "image" in it || "text" in it || "iframe" in it)) {
      return { layout: { direction: "row", children: items } };
    }
    throw new Error("unclassifiable YAML list block (neither adapters nor layout nodes)");
  }
  if (isRecordObj(parsed)) {
    const keys = Object.keys(parsed);
    if (keys.length === 1 && keys[0] === "transforms") {
      return {
        adapters: [
          {
            name: "doc-example",
            type: "rss",
            params: { urls: ["https://example.com/feed.xml"] },
            transforms: parsed.transforms,
          },
        ],
      };
    }
    return { ...parsed };
  }
  throw new Error("YAML block did not parse to a list or mapping");
}

/** Add stand-in adapters for source names the fragment references but does not define. */
function synthesizeMissingSources(config: Record<string, unknown>): void {
  const adapters = Array.isArray(config.adapters) ? [...config.adapters] : [];
  const defined = new Set<string>();
  for (const adapter of adapters) {
    if (!isRecordObj(adapter)) continue;
    const name = typeof adapter.name === "string" ? adapter.name : adapter.type;
    if (typeof name === "string") defined.add(name);
  }
  const pipelines = Array.isArray(config.pipelines) ? config.pipelines : [];
  for (const pipeline of pipelines) {
    if (isRecordObj(pipeline) && typeof pipeline.name === "string") defined.add(pipeline.name);
  }

  const { referenced, counterSources } = collectSourceRefs(config);
  for (const name of referenced) {
    if (defined.has(name)) continue;
    defined.add(name);
    adapters.push(
      counterSources.has(name)
        ? {
            name,
            type: "counter",
            params: { url: "https://example.com/api", json_path: "value", label: "Example" },
          }
        : { name, type: "rss", params: { urls: ["https://example.com/feed.xml"] } },
    );
  }
  if (adapters.length > 0) config.adapters = adapters;
}

/** Validate a config object, treating any config warning as a failure. */
function validateStrict(config: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const spy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  });
  try {
    validateParsedConfig(config, DEFAULT_LAYOUT);
  } finally {
    spy.mockRestore();
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Preset helpers
// ---------------------------------------------------------------------------

const ACTUAL_PRESETS = readdirSync(join(ROOT, "presets"))
  .filter((f) => /^config\..+\.yaml$/.test(f))
  .map((f) => f.replace(/^config\./, "").replace(/\.yaml$/, ""))
  .sort();

/** Extract preset names from a `pace presets list` output block in a skill. */
function extractPresetListNames(markdown: string): string[] {
  const block = extractFencedBlocks(markdown).find((b) =>
    b.content.includes("pace presets list"),
  );
  if (!block) return [];
  const names: string[] = [];
  for (const line of block.content.split("\n")) {
    const m = /^#\s+([a-z0-9][a-z0-9-]*)(?:\s+--\s+.+)?$/.exec(line);
    if (m) names.push(m[1]!);
  }
  return names.sort();
}

// ---------------------------------------------------------------------------
// Existing coverage: every adapter/transform type is documented
// ---------------------------------------------------------------------------

describe("skills-sync: pace-config coverage", () => {
  describe("adapter types", () => {
    for (const type of ADAPTER_TYPES) {
      test(`has ### ${type} heading`, () => {
        expect(configSkill).toContain(`### ${type}`);
      });
    }
  });

  describe("transform types", () => {
    for (const type of TRANSFORM_TYPES) {
      test(`has ### ${type} heading or type: ${type} reference`, () => {
        const hasHeading = configSkill.includes(`### ${type}`);
        const hasTypeRef = configSkill.includes(`type: ${type}`);
        expect(hasHeading || hasTypeRef).toBe(true);
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Drift protection: skill YAML examples must validate against the real schema
// ---------------------------------------------------------------------------

describe("skills-sync: pace-config YAML examples validate", () => {
  const yamlBlocks = extractFencedBlocks(configSkill).filter((b) => b.lang === "yaml");

  test("skill contains YAML example blocks", () => {
    expect(yamlBlocks.length).toBeGreaterThan(20);
  });

  for (const [blockIndex, block] of yamlBlocks.entries()) {
    const docs = splitTopLevelDocs(block.content);
    for (const [docIndex, doc] of docs.entries()) {
      const label =
        docs.length > 1
          ? `block ${blockIndex} ("${block.heading}") variant ${docIndex + 1}`
          : `block ${blockIndex} ("${block.heading}")`;
      test(`${label} passes config validation without warnings`, () => {
        const parsed = yaml.load(doc);
        const config = fragmentToConfig(parsed);
        synthesizeMissingSources(config);
        const warnings = validateStrict(config);
        expect(warnings).toEqual([]);
      });
    }
  }
});

describe("skills-sync: pace-config adapter reference sections", () => {
  const referenceSection = configSkill.slice(
    configSkill.indexOf("## Adapter reference"),
    configSkill.indexOf("## Transform reference"),
  );
  const headings = [...referenceSection.matchAll(/^### (.+)$/gm)].map((m) => m[1]!);

  test("adapter reference section found", () => {
    expect(headings.length).toBeGreaterThan(0);
  });

  for (const heading of headings) {
    test(`### ${heading} is a real adapter type`, () => {
      expect(isAdapterType(heading)).toBe(true);
    });
  }

  test("every adapter section example uses the adapter type it documents", () => {
    const sections = referenceSection.split(/^### /m).slice(1);
    for (const section of sections) {
      const name = section.split("\n", 1)[0]!.trim();
      const yamlBlock = extractFencedBlocks(`### ${name}\n${section}`).find(
        (b) => b.lang === "yaml",
      );
      expect(yamlBlock, `adapter section "${name}" has a YAML example`).toBeDefined();
      expect(yamlBlock!.content).toContain(`type: ${name}`);
    }
  });
});

describe("skills-sync: pace-config transform reference", () => {
  test("documents only real transform types", () => {
    const referenceSection = configSkill.slice(
      configSkill.indexOf("## Transform reference"),
      configSkill.indexOf("## Pipelines"),
    );
    const documented = [
      ...referenceSection.matchAll(/^\s*- type:\s*([\w-]+)/gm),
    ].map((m) => m[1]!);
    expect(documented.length).toBeGreaterThan(0);
    for (const type of documented) {
      expect(TRANSFORM_TYPES as readonly string[]).toContain(type);
    }
  });
});

// ---------------------------------------------------------------------------
// Drift protection: preset listings in both skills match the presets dir
// ---------------------------------------------------------------------------

describe("skills-sync: preset listings", () => {
  test("presets directory has presets", () => {
    expect(ACTUAL_PRESETS.length).toBeGreaterThan(0);
  });

  test("pace-config presets list block matches bundled presets", () => {
    expect(extractPresetListNames(configSkill)).toEqual(ACTUAL_PRESETS);
  });

  test("pace-setup presets list block matches bundled presets", () => {
    expect(extractPresetListNames(setupSkill)).toEqual(ACTUAL_PRESETS);
  });

  for (const [skillName, content] of [
    ["pace-config", configSkill],
    ["pace-setup", setupSkill],
  ] as const) {
    test(`${skillName} --preset references resolve to bundled presets`, () => {
      const refs = [...content.matchAll(/--preset\s+([\w-]+)/g)].map((m) => m[1]!);
      expect(refs.length).toBeGreaterThan(0);
      for (const ref of refs) {
        expect(ACTUAL_PRESETS).toContain(ref);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Drift protection: pace-setup CLI/runtime claims match the code
// ---------------------------------------------------------------------------

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("skills-sync: pace-setup matches CLI behavior", () => {
  test("commands table lists only real CLI commands", () => {
    const tableSection = setupSkill.slice(
      setupSkill.indexOf("**Commands overview:**"),
      setupSkill.indexOf("Key options:"),
    );
    const rows = [...tableSection.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]!);
    expect(rows.length).toBeGreaterThan(5);
    for (const row of rows) {
      const commandName = row.split(/\s+/)[0]!;
      expect(getCliCommand(commandName), `command "${commandName}" exists`).toBeDefined();
    }
  });

  test("documented short/long option pairs match CLI_PARSE_OPTIONS", () => {
    const pairs = [...setupSkill.matchAll(/`-([A-Za-z])\/--([a-z-]+)/g)].map((m) => ({
      short: m[1]!,
      long: m[2]!,
    }));
    expect(pairs.length).toBeGreaterThan(2);
    const options = CLI_PARSE_OPTIONS as Record<string, { type: string; short?: string }>;
    for (const { short, long } of pairs) {
      const option = options[long];
      expect(option, `--${long} is a real CLI option`).toBeDefined();
      expect(option!.short, `-${short} is the short flag for --${long}`).toBe(short);
    }
  });

  test("documented environment variables are read by the code", () => {
    const envVars = [...setupSkill.matchAll(/`(PACE_[A-Z_]+|PORT)`/g)].map((m) => m[1]!);
    expect(new Set(envVars).size).toBeGreaterThan(2);
    const sources = listSourceFiles(join(ROOT, "src"))
      .map((f) => readFileSync(f, "utf-8"))
      .join("\n");
    for (const name of new Set(envVars)) {
      expect(sources, `process.env.${name} is used in src/`).toContain(`process.env.${name}`);
    }
  });

  test("documented default port matches the code default", () => {
    const defaultPort = parsePort(undefined);
    const claims = [...setupSkill.matchAll(/localhost:(\d+)/g)].map((m) => Number(m[1]));
    expect(claims.length).toBeGreaterThan(0);
    for (const claimed of claims) {
      expect(claimed).toBe(defaultPort);
    }
    expect(setupSkill).toContain(`default ${defaultPort}`);
    expect(configSkill).toContain(`:${defaultPort}`);
  });

  test("documented default refresh interval matches the scheduler default", () => {
    expect(setupSkill).toContain(`default ${DEFAULT_REFRESH_INTERVAL_MIN}`);
    expect(configSkill).toContain(`default ${DEFAULT_REFRESH_INTERVAL_MIN}`);
  });
});
