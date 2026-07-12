import { describe, it, expect, beforeAll } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { validateParsedConfig } from "./config-validate";
import { renderDashboard, type PanelData } from "./layout";
import {
  collectPanels,
  isContainer,
  isImageWidget,
  isIframe,
  isPanel,
  isTextWidget,
  normalizeSource,
  resolvePanelId,
  type LayoutNodeConfig,
  type PanelConfig,
} from "./config/types";
import { isAdapterType, ADAPTER_PARAM_KEYS } from "./adapters/params";
import { DEFAULT_LAYOUT } from "./config/domain";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { applyKeywordScore } from "./transform-rank";

const ROOT = join(import.meta.dir, "..");
const PRESETS_DIR = join(ROOT, "presets");

const PRESET_NAMES = readdirSync(PRESETS_DIR)
  .filter((f) => /^config\..+\.yaml$/.test(f))
  .map((f) => f.replace(/^config\./, "").replace(/\.yaml$/, ""))
  .sort();

/** Load and parse a preset YAML from the presets folder. */
function loadPresetYaml(name: string): Record<string, unknown> {
  const raw = readFileSync(join(PRESETS_DIR, `config.${name}.yaml`), "utf-8");
  const parsed = yaml.load(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Preset ${name}: expected an object at top level`);
  }
  return parsed as Record<string, unknown>;
}

/** Walk all layout nodes recursively. */
function walkLayoutNodes(node: LayoutNodeConfig, fn: (n: LayoutNodeConfig) => void): void {
  fn(node);
  if (isContainer(node)) {
    for (const child of node.children) {
      walkLayoutNodes(child, fn);
    }
  }
}

/** Create mock PanelData for all panels in a layout. */
function mockPanelData(layout: LayoutNodeConfig): Map<string, PanelData> {
  const panels = collectPanels(layout);
  const data = new Map<string, PanelData>();
  for (const panel of panels) {
    const panelName = panel.panel;
    // Create 2 mock items per panel to produce realistic HTML
    const items = [
      makeItem({
        id: `${panelName}-1`,
        title: `Item 1 for ${panelName}`,
        url: "https://example.com/1",
        source: typeof panel.source === "string" ? panel.source : "test",
        body: panel.display === "counter"
          ? JSON.stringify({ value: 42, unit: "count" })
          : "Test body content",
      }),
      makeItem({
        id: `${panelName}-2`,
        title: `Item 2 for ${panelName}`,
        url: "https://example.com/2",
        source: typeof panel.source === "string" ? panel.source : "test",
        body: panel.display === "counter"
          ? JSON.stringify({ value: 38, unit: "count" })
          : "Another body",
      }),
    ];
    data.set(panelName, { panelId: resolvePanelId(panel), items, lastRefreshedAt: null });
  }
  return data;
}

/**
 * Simple HTML tag-balance check. Verifies that key structural tags are balanced.
 * Not a full HTML parser, but catches broken nesting from widget rendering.
 */
function checkHtmlBalance(html: string): string[] {
  const errors: string[] = [];

  // Check that every <div has a matching </div>
  const openDivs = (html.match(/<div[\s>]/g) || []).length;
  const closeDivs = (html.match(/<\/div>/g) || []).length;
  if (openDivs !== closeDivs) {
    errors.push(`Unbalanced <div>: ${openDivs} opens vs ${closeDivs} closes`);
  }

  // Check <section> balance
  const openSections = (html.match(/<section[\s>]/g) || []).length;
  const closeSections = (html.match(/<\/section>/g) || []).length;
  if (openSections !== closeSections) {
    errors.push(`Unbalanced <section>: ${openSections} opens vs ${closeSections} closes`);
  }

  // Check <h2> balance
  const openH2 = (html.match(/<h2[\s>]/g) || []).length;
  const closeH2 = (html.match(/<\/h2>/g) || []).length;
  if (openH2 !== closeH2) {
    errors.push(`Unbalanced <h2>: ${openH2} opens vs ${closeH2} closes`);
  }

  // Check <html> has </html>
  if (html.includes("<html") && !html.includes("</html>")) {
    errors.push("Missing </html>");
  }

  // Check <body> has </body>
  if (html.includes("<body>") && !html.includes("</body>")) {
    errors.push("Missing </body>");
  }

  return errors;
}

// ============================================================
// 1. Preset Config Validity
// ============================================================

describe("Preset config validity", () => {
  for (const name of PRESET_NAMES) {
    describe(`config.${name}.yaml`, () => {
      let parsed: Record<string, unknown>;
      let validated: ReturnType<typeof validateParsedConfig>;

      beforeAll(() => {
        parsed = loadPresetYaml(name);
        validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
      });

      it("is valid YAML and loads as an object", () => {
        expect(parsed).toBeDefined();
        expect(typeof parsed).toBe("object");
      });

      it("passes validation with zero errors", () => {
        // If validateParsedConfig throws, the test fails automatically.
        // This is a sanity check that validated sections exist.
        expect(validated.adapters).toBeDefined();
        expect(validated.layout).toBeDefined();
        expect(validated.pipelines).toBeDefined();
      });

      it("has at least one adapter", () => {
        expect(validated.adapters.length).toBeGreaterThanOrEqual(1);
      });

      it("has at least one panel in the layout", () => {
        const panels = collectPanels(validated.layout);
        expect(panels.length).toBeGreaterThanOrEqual(1);
      });

      it("all adapter types are recognized", () => {
        for (const adapter of validated.adapters) {
          expect(isAdapterType(adapter.type)).toBe(true);
        }
      });

      it("all panel source references point to declared adapters or pipelines (or 'all')", () => {
        const adapterNames = new Set(
          validated.adapters.map((a) => a.name ?? a.type),
        );
        const pipelineNames = new Set(
          validated.pipelines.map((p) => p.name),
        );
        const allSourceNames = new Set([...adapterNames, ...pipelineNames]);

        const panels = collectPanels(validated.layout);
        for (const panel of panels) {
          const sources = normalizeSource(panel.source);
          for (const src of sources) {
            if (src.adapter === "all") continue;
            expect(allSourceNames.has(src.adapter)).toBe(true);
          }
        }
      });

      it("adapter param keys are all valid for their type", () => {
        for (const adapter of validated.adapters) {
          if (!isAdapterType(adapter.type)) continue;
          const allowedKeys: readonly string[] = ADAPTER_PARAM_KEYS[adapter.type];
          if (adapter.params) {
            for (const key of Object.keys(adapter.params)) {
              expect(allowedKeys).toContain(key);
            }
          }
        }
      });
    });
  }
});

// ============================================================
// 2. Preset Layout Rendering
// ============================================================

describe("Preset layout rendering", () => {
  for (const name of PRESET_NAMES) {
    describe(`config.${name}.yaml renders to valid HTML`, () => {
      let validated: ReturnType<typeof validateParsedConfig>;
      let html: string;

      beforeAll(() => {
        const parsed = loadPresetYaml(name);
        validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
        const panelData = mockPanelData(validated.layout);
        html = renderDashboard({
          layout: validated.layout,
          panelData,
          updatedAt: "2026-06-14 12:00:00",
        });
      });

      it("produces non-empty HTML", () => {
        expect(html.length).toBeGreaterThan(100);
      });

      it("starts with DOCTYPE", () => {
        expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
      });

      it("has balanced structural tags", () => {
        const errors = checkHtmlBalance(html);
        if (errors.length > 0) {
          throw new Error(`HTML balance errors in ${name}:\n${errors.join("\n")}`);
        }
      });

      it("contains all declared panel names as headings", () => {
        const panels = collectPanels(validated.layout);
        for (const panel of panels) {
          // JSX escapes ampersands in reader-facing headings.
          expect(html).toContain(panel.panel.replaceAll("&", "&amp;"));
        }
      });

      it("contains widget components when layout has widgets", () => {
        let hasImageWidget = false;
        let hasTextWidget = false;
        let hasIframeWidget = false;

        walkLayoutNodes(validated.layout, (node) => {
          if (isImageWidget(node)) hasImageWidget = true;
          if (isTextWidget(node)) hasTextWidget = true;
          if (isIframe(node)) hasIframeWidget = true;
        });

        if (hasImageWidget) {
          expect(html).toContain("image-widget");
        }
        if (hasTextWidget) {
          expect(html).toContain("text-widget");
        }
        if (hasIframeWidget) {
          expect(html).toContain("iframe-panel");
        }
      });

      it("contains counter display when layout uses display:counter", () => {
        const panels = collectPanels(validated.layout);
        const hasCounter = panels.some((p) => p.display === "counter");
        if (hasCounter) {
          expect(html).toContain("counter-panel");
        }
      });
    });
  }
});

it("tech-news uses reader-facing panel headings with stable IDs", () => {
  const parsed = loadPresetYaml("tech-news");
  const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
  const html = renderDashboard({
    layout: validated.layout,
    panelData: mockPanelData(validated.layout),
    updatedAt: "2026-07-12 12:00:00",
  });

  expect(
    collectPanels(validated.layout).map(({ panel, id }) => [panel, id]),
  ).toEqual([
    ["Front Page", "frontpage"],
    ["Fediverse", "fediverse"],
    ["Releases", "releases"],
    ["News & Blogs", "news-and-blogs"],
    ["Reference", "reference"],
  ]);
  expect(html).toContain('<h2 title="News &amp; Blogs">News &amp; Blogs</h2>');
  expect(html).toContain('action="/refresh/news-and-blogs"');
});

it("academic-papers uses reader-facing panel headings with stable IDs", () => {
  const parsed = loadPresetYaml("academic-papers");
  const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
  const html = renderDashboard({
    layout: validated.layout,
    panelData: mockPanelData(validated.layout),
    updatedAt: "2026-07-12 12:00:00",
  });

  expect(
    collectPanels(validated.layout).map(({ panel, id }) => [panel, id]),
  ).toEqual([
    ["Recent Papers by Category", "papers-categories"],
    ["Focused Paper Search", "papers-search"],
    ["Research Discussion", "discussion"],
    ["Science Writing", "science-writing"],
    ["Theory Questions", "questions"],
  ]);
  expect(html).toContain('<h2 title="Recent Papers by Category">Recent Papers by Category</h2>');
  expect(html).toContain('action="/refresh/papers-categories"');
});

it("release-tracker uses reader-facing panel headings with stable IDs", () => {
  const parsed = loadPresetYaml("release-tracker");
  const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
  const html = renderDashboard({
    layout: validated.layout,
    panelData: mockPanelData(validated.layout),
    updatedAt: "2026-07-12 12:00:00",
  });

  expect(
    collectPanels(validated.layout).map(({ panel, id }) => [panel, id]),
  ).toEqual([
    ["Dependency Releases", "releases"],
    ["Release Discussion", "release-chatter"],
    ["Trending Repositories", "trending"],
  ]);
  expect(html).toContain('<h2 title="Dependency Releases">Dependency Releases</h2>');
  expect(html).toContain('action="/refresh/releases"');
});

it("product-launches filters community posts for launch intent", () => {
  const parsed = loadPresetYaml("product-launches");
  const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
  const community = validated.pipelines.find(({ name }) => name === "community");
  const keywordScore = community?.transforms.find(({ type }) => type === "keyword-score");
  if (!keywordScore || keywordScore.type !== "keyword-score") {
    throw new Error("product-launches community pipeline is missing keyword-score");
  }

  expect(keywordScore.min_score).toBe(1);
  const result = applyKeywordScore([
    makeItem({ id: "launch", title: "I built and launched a new demo" }),
    makeItem({ id: "generic", title: "CSS color palette notes" }),
    makeItem({ id: "hiring", title: "Hiring: developer career and salary guide" }),
  ], keywordScore);

  expect(result.map(({ id }) => id)).toEqual(["launch"]);
});

it("video-podcast uses the advertised publisher feeds", () => {
  const parsed = loadPresetYaml("video-podcast");
  const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
  const podcast = validated.adapters.find(({ type }) => type === "podcast");

  expect(podcast?.params?.feeds).toEqual([
    "https://changelog.com/podcast/feed",
    "https://api.substack.com/feed/podcast/1084089.rss",
    "https://lexfridman.com/feed/podcast/",
  ]);
  expect(podcast?.params?.feeds).not.toContain("https://feeds.simplecast.com/54nAGcIl");
  expect(podcast?.params?.feeds).not.toContain("https://feeds.buzzsprout.com/2226484.rss");
});

// ============================================================
// 3. config.example.yaml Validity
// ============================================================

describe("config.example.yaml validity", () => {
  it("is valid YAML", () => {
    const raw = readFileSync(join(ROOT, "config.example.yaml"), "utf-8");
    const parsed = yaml.load(raw);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();
  });

  it("passes full validation", () => {
    const raw = readFileSync(join(ROOT, "config.example.yaml"), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
    expect(validated.adapters.length).toBeGreaterThanOrEqual(1);
    expect(collectPanels(validated.layout).length).toBeGreaterThanOrEqual(1);
  });

  it("renders to valid HTML with mock data", () => {
    const raw = readFileSync(join(ROOT, "config.example.yaml"), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
    const panelData = mockPanelData(validated.layout);
    const html = renderDashboard({
      layout: validated.layout,
      panelData,
      updatedAt: "2026-06-14 12:00:00",
    });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    const errors = checkHtmlBalance(html);
    expect(errors).toEqual([]);
  });
});

// ============================================================
// 4. Preset Consistency Checks
// ============================================================

describe("Preset consistency checks", () => {
  const allPresets: Array<{
    name: string;
    validated: ReturnType<typeof validateParsedConfig>;
  }> = [];

  beforeAll(() => {
    for (const name of PRESET_NAMES) {
      const parsed = loadPresetYaml(name);
      const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
      allPresets.push({ name, validated });
    }
  });

  it("all presets use consistent naming convention (lowercase-with-dashes for file names)", () => {
    for (const name of PRESET_NAMES) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it("no preset references an adapter type that does not exist in ADAPTER_PARAM_KEYS", () => {
    for (const { name, validated } of allPresets) {
      for (const adapter of validated.adapters) {
        if (!isAdapterType(adapter.type)) {
          throw new Error(`Preset ${name}: unknown adapter type "${adapter.type}"`);
        }
      }
    }
  });

  it("all pipeline sources reference declared adapters within the same preset", () => {
    for (const { name, validated } of allPresets) {
      const adapterNames = new Set(validated.adapters.map((a) => a.name ?? a.type));
      for (const pipeline of validated.pipelines) {
        for (const srcName of pipeline.sources) {
          if (!adapterNames.has(srcName)) {
            throw new Error(
              `Preset ${name}: pipeline "${pipeline.name}" references unknown source "${srcName}"`,
            );
          }
        }
      }
    }
  });

  it("no preset has duplicate adapter names", () => {
    for (const { name, validated } of allPresets) {
      const names = validated.adapters.map((a) => a.name ?? a.type);
      const seen = new Set<string>();
      for (const n of names) {
        if (seen.has(n)) {
          throw new Error(`Preset ${name}: duplicate adapter name "${n}"`);
        }
        seen.add(n);
      }
    }
  });

  it("no preset has duplicate panel names", () => {
    for (const { name, validated } of allPresets) {
      const panels = collectPanels(validated.layout);
      const seen = new Set<string>();
      for (const panel of panels) {
        if (seen.has(panel.panel)) {
          throw new Error(`Preset ${name}: duplicate panel name "${panel.panel}"`);
        }
        seen.add(panel.panel);
      }
    }
  });

  it("all presets with bookmarks adapter have at least one bookmark item configured", () => {
    for (const { name, validated } of allPresets) {
      for (const adapter of validated.adapters) {
        if (adapter.type === "bookmarks") {
          const params = adapter.params as Record<string, unknown> | undefined;
          const items = params?.items;
          expect(Array.isArray(items)).toBe(true);
          expect((items as unknown[]).length).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("all presets with counter adapter have required params (url, json_path)", () => {
    for (const { name, validated } of allPresets) {
      for (const adapter of validated.adapters) {
        if (adapter.type === "counter") {
          const params = adapter.params as Record<string, unknown> | undefined;
          expect(params?.url).toBeDefined();
          expect(typeof params?.url).toBe("string");
          expect(params?.json_path).toBeDefined();
          expect(typeof params?.json_path).toBe("string");
        }
      }
    }
  });

  it("all image widgets use safe URLs (https or localhost http)", () => {
    for (const { name, validated } of allPresets) {
      walkLayoutNodes(validated.layout, (node) => {
        if (isImageWidget(node)) {
          const url = new URL(node.image);
          const isHttps = url.protocol === "https:";
          const isLocalhostHttp =
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
          expect(isHttps || isLocalhostHttp).toBe(true);
        }
      });
    }
  });

  it("all iframe widgets use safe URLs", () => {
    for (const { name, validated } of allPresets) {
      walkLayoutNodes(validated.layout, (node) => {
        if (isIframe(node)) {
          const url = new URL(node.iframe);
          const isHttps = url.protocol === "https:";
          const isLocalhostHttp =
            url.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
          expect(isHttps || isLocalhostHttp).toBe(true);
        }
      });
    }
  });
});

// ============================================================
// 6. Individual preset rendering with widget-specific assertions
// ============================================================

describe("Preset rendering: ops-dashboard (all widget types)", () => {
  let html: string;

  beforeAll(() => {
    const raw = readFileSync(join(import.meta.dir, "test/ops-dashboard-fixture.yaml"), "utf-8");
    const parsed = yaml.load(raw) as Record<string, unknown>;
    const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
    const panelData = mockPanelData(validated.layout);
    html = renderDashboard({
      layout: validated.layout,
      panelData,
      updatedAt: "2026-06-14 12:00:00",
    });
  });

  it("renders iframe widgets with sandbox and referrerpolicy", () => {
    expect(html).toContain("<iframe");
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain("sandbox=");
  });

  it("renders image widget with alt text and object-fit", () => {
    expect(html).toContain("image-widget");
    expect(html).toContain("Bun CI status");
    expect(html).toContain("object-fit");
  });

  it("renders text widget with markdown content", () => {
    expect(html).toContain("text-widget");
    expect(html).toContain("Runbook");
  });

  it("renders counter panels with stat cards", () => {
    expect(html).toContain("counter-panel");
    expect(html).toContain("stat-card");
  });
});

describe("Preset rendering: daily-brief (text widget)", () => {
  let html: string;

  beforeAll(() => {
    const parsed = loadPresetYaml("daily-brief");
    const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
    const panelData = mockPanelData(validated.layout);
    html = renderDashboard({
      layout: validated.layout,
      panelData,
      updatedAt: "2026-06-14 12:00:00",
    });
  });

  it("renders the About text widget", () => {
    expect(html).toContain("text-widget");
    expect(html).toContain("About This Briefing");
  });
});

describe("Preset rendering: release-tracker (image + text widgets)", () => {
  let html: string;

  beforeAll(() => {
    const parsed = loadPresetYaml("release-tracker");
    const validated = validateParsedConfig(parsed, DEFAULT_LAYOUT);
    const panelData = mockPanelData(validated.layout);
    html = renderDashboard({
      layout: validated.layout,
      panelData,
      updatedAt: "2026-06-14 12:00:00",
    });
  });

  it("renders a CI badge image widget", () => {
    expect(html).toContain("image-widget");
    expect(html).toContain("Next.js CI status");
  });

  it("renders a how-to text widget", () => {
    expect(html).toContain("text-widget");
    expect(html).toContain("How to Use");
  });
});
