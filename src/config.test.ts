import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spyConsole } from "./test/console-spy";
import { sourcePanelMapFromConfig } from "./test/panel-map";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeSource,
  collectPanels,
  resolvePanelId,
  buildLayoutRuntimeMaps,
  isPanel,
  isContainer,
  type PanelConfig,
  type LayoutNodeConfig,
} from "./config/types";
import {
  loadConfig,
  resolveConfigPath,
  readConfigSource,
  configFileNotFoundError,
} from "./config";
import { validateSafeUrl, sanitizeSandboxTokens } from "./config-validate";

describe("config", () => {
  describe("helpers", () => {
  test("isPanel", () => {
    const panel: PanelConfig = { panel: "p1", source: "all" };
    const container: LayoutNodeConfig = { direction: "row", children: [] };
    expect(isPanel(panel)).toBe(true);
    expect(isPanel(container)).toBe(false);
    expect(isPanel({ foo: 1 })).toBe(false);
    expect(isPanel(null)).toBe(false);
  });

  test("isContainer", () => {
    const container = { direction: "column" as const, children: [] };
    const panel = { panel: "p", source: "all" };
    expect(isContainer(container)).toBe(true);
    expect(isContainer(panel)).toBe(false);
    expect(isContainer({ direction: "row" })).toBe(false);
  });

  test("normalizeSource", () => {
    expect(normalizeSource("rss")).toEqual([{ adapter: "rss" }]);
    expect(normalizeSource(["a", "b"])).toEqual([{ adapter: "a" }, { adapter: "b" }]);
    const obj = { adapter: "hn", params: { foo: 1 } };
    expect(normalizeSource(obj)).toEqual([obj]);
    const arr = ["s1", { adapter: "s2" }, "s3"];
    expect(normalizeSource(arr)).toEqual([{ adapter: "s1" }, { adapter: "s2" }, { adapter: "s3" }]);
  });

  test("collectPanels", () => {
    const leaf: PanelConfig = { panel: "leaf", source: "all", limit: 10 };
    const single = leaf;
    expect(collectPanels(single)).toEqual([leaf]);

    const row = {
      direction: "row" as const,
      children: [
        { panel: "p1", source: "s1" },
        {
          direction: "column" as const,
          children: [
            { panel: "p2", source: "s2", id: "id2" },
            { panel: "p3", source: ["a", "b"] },
          ],
        },
      ],
    };
    const panels = collectPanels(row);
    expect(panels.map((p) => p.panel)).toEqual(["p1", "p2", "p3"]);
    expect(panels[1].id).toBe("id2");
  });

  test("collectPanels skips widget nodes in nested layouts", () => {
    const layout: LayoutNodeConfig = {
      direction: "row" as const,
      children: [
        { image: "https://example.com/logo.png" } as LayoutNodeConfig,
        { panel: "news", source: "hn" },
        {
          direction: "column" as const,
          children: [
            { text: "Welcome" } as LayoutNodeConfig,
            { panel: "tech", source: "rss" },
            { iframe: "https://example.com" } as LayoutNodeConfig,
          ],
        },
      ],
    };
    const panels = collectPanels(layout);
    expect(panels.map((p) => p.panel)).toEqual(["news", "tech"]);
  });

  test("resolvePanelId", () => {
    const withId = { panel: "x", source: "all", id: "myid123" };
    expect(resolvePanelId(withId)).toBe("myid123");

    const p1 = { panel: "a", source: "s", limit: 5 };
    const p2 = { panel: "a", source: "s", limit: 5 };
    const p3 = { panel: "a", source: "s", limit: 10 };
    const id1 = resolvePanelId(p1);
    expect(id1).toMatch(/^[0-9a-f]{8}$/);
    expect(resolvePanelId(p2)).toBe(id1);
    expect(resolvePanelId(p3)).not.toBe(id1);
  });

  test("buildLayoutRuntimeMaps maps panels to sources and registers orphan adapters", () => {
    const layout = {
      direction: "column" as const,
      children: [
        { panel: "global", source: "all" },
        { panel: "tech", source: "hackernews", id: "hn-panel" },
        { panel: "mixed", source: ["rss", "podcast"] },
      ],
    };
    const maps = buildLayoutRuntimeMaps(layout, ["orphan-adapter", "hackernews"]);

    expect(maps.panelNameToId.get("tech")).toBe("hn-panel");
    expect(maps.panelIdToSources.get("hn-panel")).toEqual([{ adapter: "hackernews" }]);
    expect(maps.panelIdToRefreshSourceNames.get("hn-panel")).toEqual(["hackernews"]);
    expect(maps.dashboardPanels.map((d) => d.panel.panel)).toEqual(["global", "tech", "mixed"]);
    expect(maps.dashboardPanels.find((d) => d.panel.panel === "global")?.isAll).toBe(true);

    expect(maps.sourceToPanels.get("hackernews")).toEqual(["hn-panel"]);
    expect(maps.sourceToPanels.get("rss")).toEqual([resolvePanelId(layout.children[2] as PanelConfig)]);
    expect(maps.sourceToPanels.get("podcast")).toEqual([resolvePanelId(layout.children[2] as PanelConfig)]);
    expect(maps.sourceToPanels.has("all")).toBe(false);

    expect(maps.sourceToReadKey.get("hackernews")).toBe("hn-panel");
    expect(maps.sourceToPanels.get("orphan-adapter")).toEqual(["orphan-adapter"]);
    expect(maps.sourceToReadKey.get("orphan-adapter")).toBe("orphan-adapter");
  });

  test("buildLayoutRuntimeMaps precomputes refresh source names for all and mixed panels", () => {
    const layout = {
      direction: "column" as const,
      children: [
        { panel: "global", source: "all" },
        { panel: "mixed", source: ["rss", "podcast"] },
      ],
    };
    const pipelines = [{ name: "curated" }, { name: "firehose" }];
    const maps = buildLayoutRuntimeMaps(layout, ["hn", "rss"], pipelines);
    const globalId = resolvePanelId(layout.children[0] as PanelConfig);
    const mixedId = resolvePanelId(layout.children[1] as PanelConfig);

    expect(maps.panelIdToRefreshSourceNames.get(globalId)).toEqual([
      "hn",
      "rss",
      "curated",
      "firehose",
    ]);
    expect(maps.panelIdToRefreshSourceNames.get(mixedId)).toEqual(["rss", "podcast"]);
  });

  test("sourcePanelMapFromConfig matches buildLayoutRuntimeMaps source/read maps", () => {
    const config = {
      adapters: [{ type: "hackernews", name: "hn" }],
      layout: {
        direction: "row" as const,
        children: [
          { panel: "tech", source: "hn", id: "hn-panel" },
          { panel: "pipe", source: "curated", id: "out" },
        ],
      },
      pipelines: [{ name: "curated", sources: ["hn"], transforms: [] }],
    };
    const fromConfig = sourcePanelMapFromConfig(config);
    const fromLayout = buildLayoutRuntimeMaps(config.layout, ["hn"]);

    expect(fromConfig.sourceToPanels).toEqual(fromLayout.sourceToPanels);
    expect(fromConfig.sourceToReadKey).toEqual(fromLayout.sourceToReadKey);
    expect(fromConfig.sourceToPanels.get("hn")).toEqual(["hn-panel"]);
    expect(fromConfig.sourceToPanels.get("curated")).toEqual(["out"]);
    expect(fromConfig.sourceToReadKey.get("hn")).toBe("hn-panel");
  });
  });

  describe("loadConfig", () => {
  let tmpDir: string;
  let cfgPath: string;
  let origEnv: string | undefined;

  beforeEach(() => {
    origEnv = process.env.PACE_CONFIG;
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-cfg-test-"));
    cfgPath = path.join(tmpDir, "config.yaml");
  });

  afterEach(() => {
    process.env.PACE_CONFIG = origEnv;
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function setConfig(yamlContent: string) {
    fs.writeFileSync(cfgPath, yamlContent, "utf-8");
    process.env.PACE_CONFIG = cfgPath;
  }

  test("minimal valid config with all source", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: testpanel
      source: all
      limit: 5
`;
    setConfig(yaml);
    const cfg = loadConfig();
    expect(cfg.adapters).toEqual([]);
    expect(cfg.pipelines).toBeUndefined();
    expect(cfg.layout).toBeTruthy();
    const firstChild = cfg.layout.children[0];
    expect(isPanel(firstChild)).toBe(true);
    if (isPanel(firstChild)) {
      expect(firstChild.panel).toBe("testpanel");
    }
  });

  test("rejects duplicate explicit panel id", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: left
      source: all
      id: shared
    - panel: right
      source: all
      id: shared
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: duplicate panel ID "shared" \(panels: "left", "right"\)/,
    );
  });

  test("rejects duplicate panel name", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: shared
      source: all
    - panel: shared
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: duplicate panel name "shared"/);
  });

  test("rejects empty panel name", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: ""
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: layout.children\[0\].panel must be a non-empty string/);
  });

  test("rejects empty source adapter", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: p1
      source:
        adapter: ""
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: layout.children\[0\].source.adapter must be a non-empty string/);
  });

  test("rejects unknown panel field", () => {
    const yaml = `
layout:
  direction: row
  children:
    - panel: p1
      source: all
      typo_field: true
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].typo_field is not a valid panel field/,
    );
  });

  test("rejects unknown layout container field", () => {
    const yaml = `
layout:
  direction: row
  typo_field: true
  children:
    - panel: p1
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.typo_field is not a valid layout container field/,
    );
  });

  test("rejects refresh_interval on panel source object (belongs on adapters[])", () => {
    const yaml = `
adapters:
  - type: rss
layout:
  direction: row
  children:
    - panel: p1
      source:
        adapter: rss
        refresh_interval: 10
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].source.refresh_interval is not a valid source field/,
    );
  });

  test("rejects empty adapter type", () => {
    const yaml = `
adapters:
  - type: ""
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].type must be a non-empty string/);
  });

  test("rejects empty adapter name", () => {
    const yaml = `
adapters:
  - type: rss
    name: ""
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].name must be a non-empty string/);
  });

  test("rejects unknown adapter field", () => {
    const yaml = `
adapters:
  - type: rss
    typo_field: true
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].typo_field is not a valid adapter field/,
    );
  });

  test("rejects unknown adapter params field", () => {
    const yaml = `
adapters:
  - type: rss
    params:
      urls:
        - https://example.com/feed.xml
      typo_field: true
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].params.typo_field is not a valid rss param/,
    );
  });

  test("rejects unknown panel source params field", () => {
    const yaml = `
adapters:
  - type: rss
layout:
  direction: row
  children:
    - panel: p
      source:
        adapter: rss
        params:
          urls:
            - https://example.com/feed.xml
          typo_field: true
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout\.children\[0\]\.source\.params\.typo_field is not a valid rss param/,
    );
  });

  test("rejects unknown pipeline field", () => {
    const yaml = `
pipelines:
  - name: pl
    typo_field: true
    sources: ["s1"]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: pipelines\[0\].typo_field is not a valid pipeline field/,
    );
  });

  test("rejects empty pipeline name", () => {
    const yaml = `
pipelines:
  - name: ""
    sources: ["s1"]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: pipelines\[0\].name must be a non-empty string/);
  });

  test("rejects empty pipeline source string", () => {
    const yaml = `
pipelines:
  - name: pl
    sources: [""]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: pipelines\[0\].sources\[0\] must be a non-empty string/);
  });

  test("rejects duplicate adapter name", () => {
    const yaml = `
adapters:
  - type: rss
  - type: hackernews
    name: rss
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[1\] duplicates adapter name "rss"/,
    );
  });

  test("rejects duplicate adapter type when name omitted", () => {
    const yaml = `
adapters:
  - type: rss
    params:
      urls: ["https://example.com/feed.xml"]
  - type: rss
    params:
      urls: ["https://other.example/feed.xml"]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[1\] duplicates adapter type "rss"/,
    );
  });

  test("allows multiple adapters of same type with distinct names", () => {
    const yaml = `
adapters:
  - type: rss
    name: feed-a
    params:
      urls: ["https://a.example/feed.xml"]
  - type: rss
    name: feed-b
    params:
      urls: ["https://b.example/feed.xml"]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    const config = loadConfig();
    expect(config.adapters).toHaveLength(2);
    expect(config.adapters.map((a) => a.name)).toEqual(["feed-a", "feed-b"]);
  });

  test("rejects duplicate pipeline source", () => {
    const yaml = `
adapters:
  - type: rss
pipelines:
  - name: pl
    sources: [rss, rss]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: pipelines\[0\].sources\[1\] duplicates source "rss"/,
    );
  });

  test("rejects duplicate pipeline name", () => {
    const yaml = `
adapters:
  - type: hackernews
pipelines:
  - name: feed
    sources: [hackernews]
    transforms: []
  - name: feed
    sources: [hackernews]
    transforms: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: pipelines\[1\] duplicates pipeline name "feed"/,
    );
  });

  test("rejects pipeline name colliding with adapter name", () => {
    const yaml = `
adapters:
  - type: hackernews
pipelines:
  - name: hackernews
    sources: [hackernews]
    transforms: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: duplicate pipeline\/adapter name "hackernews"/,
    );
  });

  test("rejects unknown transform field", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: latest
        count: 5
        typo_field: true
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].typo_field is not a valid latest transform field/,
    );
  });

  test("rejects empty transform type", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: ""
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].type must be a non-empty string/);
  });

  test("rejects unknown transform type", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: not-a-transform
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].type references unknown transform "not-a-transform"/,
    );
  });

  test("rejects invalid sort transform direction enum", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: sort
        field: title
        direction: sideways
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].direction must be one of: asc, desc/,
    );
  });

  test("rejects keyword-score empty term", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: keyword-score
        keywords:
          - term: ""
            weight: 1
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].keywords\[0\].term must be a non-empty string/);
  });

  test("rejects keyword-score entry unknown field", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: keyword-score
        keywords:
          - term: rust
            weight: 1
            typo_field: x
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].keywords\[0\].typo_field is not a valid keyword-score entry field/,
    );
  });

  test("rejects filter keyword empty string", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: filter
        keywords: ["foo", ""]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].keywords\[1\] must be a non-empty string/);
  });

  test("rejects latest non-positive count", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: latest
        count: 0
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].count must be a positive integer/);
  });

  test("rejects dedupe keep on url strategy", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: dedupe
        strategy: url
        keep: latest
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].keep is only valid for dedupe strategies "domain-normalized" and "title-similarity" \(got "url"\)/,
    );
  });

  test("rejects dedupe threshold on domain-normalized strategy", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: dedupe
        strategy: domain-normalized
        threshold: 0.9
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].threshold is only valid for dedupe strategy "title-similarity" \(got "domain-normalized"\)/,
    );
  });

  test("rejects dedupe threshold when default url strategy", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: dedupe
        threshold: 0.8
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: adapters\[0\].transforms\[0\].threshold is only valid for dedupe strategy "title-similarity" \(got "url"\)/,
    );
  });

  test("accepts dedupe threshold and keep for title-similarity", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: dedupe
        strategy: title-similarity
        threshold: 0.8
        keep: earliest
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects unknown llm field", () => {
    const yaml = `
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: sk-test
  typo_field: true
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: llm\.typo_field is not a valid llm field/);
  });

  test("rejects unknown top-level key", () => {
    const yaml = `
foo: bar
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: foo is not a valid top-level field/);
  });

  test("rejects unknown adapter source references", () => {
    const layoutYaml = `
adapters:
  - type: rss
layout:
  direction: row
  children:
    - panel: news
      source: no-such-adapter
`;
    setConfig(layoutYaml);
    expect(() => loadConfig()).toThrow(
      /config: layout panel "news" source references unknown source "no-such-adapter"/,
    );

    const multiSourceYaml = `
adapters:
  - type: rss
layout:
  direction: row
  children:
    - panel: mix
      source: [rss, phantom]
`;
    setConfig(multiSourceYaml);
    expect(() => loadConfig()).toThrow(
      /config: layout panel "mix" source\[1\] references unknown source "phantom"/,
    );

    const pipelineYaml = `
adapters:
  - type: rss
pipelines:
  - name: enrich
    sources: [missing-feed]
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(pipelineYaml);
    expect(() => loadConfig()).toThrow(
      /config: pipelines\[0\].sources\[0\] references unknown source "missing-feed"/,
    );
  });

  test("rejects filter empty keywords list", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: filter
        keywords: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].keywords must not be empty/);
  });

  test("rejects keyword-score empty keywords list", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: keyword-score
        keywords: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].keywords must not be empty/);
  });

  test("rejects filter empty fields list", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: filter
        keywords: ["foo"]
        fields: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].fields must not be empty/);
  });

  test("rejects cluster non-positive min_cluster_size", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: cluster
        min_cluster_size: 0
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].min_cluster_size must be a positive integer/);
  });

  test("rejects cluster non-positive max_clusters", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: cluster
        max_clusters: -1
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].max_clusters must be a positive integer/);
  });

  test("rejects keyword-score non-number min_score", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: keyword-score
        keywords:
          - term: foo
            weight: 1
        min_score: "notnum"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].min_score must be a number/);
  });

  test("rejects time-decay non-finite recency_weight", () => {
    const yaml = `
adapters:
  - type: rss
    transforms:
      - type: time-decay
        recency_weight: Infinity
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters\[0\].transforms\[0\].recency_weight must be a number/);
  });

  test("rejects pipeline sources not a list", () => {
    const yaml = `
pipelines:
  - name: pl
    sources: "not-a-list"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: pipelines\[0\].sources must be a list/);
  });

  test("rejects pipeline empty sources list", () => {
    const yaml = `
pipelines:
  - name: pl
    sources: []
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: pipelines\[0\].sources must not be empty/);
  });

  test("rejects adapters not a list", () => {
    const yaml = `
adapters: "not-a-list"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: adapters must be a list/);
  });

  test("rejects pipelines not a list", () => {
    const yaml = `
pipelines: 123
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: pipelines must be a list/);
  });

  test("rejects invalid env var placeholder syntax in adapter params", () => {
    const yaml = `
adapters:
  - type: rss
    params:
      urls:
        - "https://example.com/\${bad-name}"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: env var placeholder \$\{bad-name\} has invalid name "bad-name"/,
    );
  });

  test("rejects cyclic env var expansion", () => {
    const keyA = "TEST_REC_CYCLE_A_" + Date.now().toString(36);
    const keyB = "TEST_REC_CYCLE_B_" + Date.now().toString(36);
    const origA = process.env[keyA];
    const origB = process.env[keyB];
    process.env[keyA] = `\${${keyB}}`;
    process.env[keyB] = `\${${keyA}}`;
    try {
      const yaml = `
adapters:
  - type: rss
    params:
      urls:
        - "\${${keyA}}"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: env var expansion exceeded 10 passes \(possible cycle\); still contains \$\{/,
      );
    } finally {
      if (origA === undefined) { delete process.env[keyA]; } else { process.env[keyA] = origA; }
      if (origB === undefined) { delete process.env[keyB]; } else { process.env[keyB] = origB; }
    }
  });

  test("warns when referenced env var is unset but still expands to empty", async () => {
    const unsetKey = "TEST_REC_UNSET_" + Date.now().toString(36);
    const orig = process.env[unsetKey];
    delete process.env[unsetKey];
    try {
      const yaml = `
adapters:
  - type: rss
    params:
      urls:
        - "https://example.com/\${${unsetKey}}/feed"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
      setConfig(yaml);
      await spyConsole(["warn"], async ({ warn }) => {
        const cfg = loadConfig();
        expect(cfg.adapters[0]?.params?.urls).toEqual(["https://example.com//feed"]);
        expect(warn).toHaveBeenCalledWith(
          `config: env var ${unsetKey} is unset (expanding to empty)`,
        );
      });
    } finally {
      if (orig === undefined) { delete process.env[unsetKey]; } else { process.env[unsetKey] = orig; }
    }
  });

  test("expands chained ${VAR} in adapter params", () => {
    const outerKey = "TEST_REC_OUTER_" + Date.now().toString(36);
    const innerKey = "TEST_REC_INNER_" + Date.now().toString(36);
    const origOuter = process.env[outerKey];
    const origInner = process.env[innerKey];
    process.env[outerKey] = `x\${${innerKey}}y`;
    process.env[innerKey] = "z";
    try {
      const yaml = `
adapters:
  - type: rss
    params:
      urls:
        - "pre\${${outerKey}}post"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
      setConfig(yaml);
      const cfg = loadConfig();
      expect(cfg.adapters[0]?.params?.urls).toEqual(["prexzypost"]);
    } finally {
      if (origOuter === undefined) { delete process.env[outerKey]; } else { process.env[outerKey] = origOuter; }
      if (origInner === undefined) { delete process.env[innerKey]; } else { process.env[innerKey] = origInner; }
    }
  });

  test("throws config-prefixed error on invalid YAML", () => {
    setConfig("layout: [:\n");
    expect(() => loadConfig()).toThrow(/config: failed to parse YAML from/);
  });

  test("throws config-prefixed error when config file is unreadable", () => {
    setConfig("layout:\n  direction: row\n  children: []\n");
    fs.chmodSync(cfgPath, 0o000);
    try {
      expect(() => loadConfig()).toThrow(/config: failed to read/);
    } finally {
      fs.chmodSync(cfgPath, 0o644);
    }
  });

  test("throws shared not-found error for explicit missing config path", () => {
    const missing = path.join(tmpDir, "missing.yaml");
    expect(() =>
      readConfigSource({ path: missing, explicit: true }),
    ).toThrow(configFileNotFoundError(missing));
  });

  test("readConfigSource falls back to config.example.yaml when implicit", () => {
    const examplePath = path.join(tmpDir, "config.example.yaml");
    fs.writeFileSync(examplePath, "layout:\n  direction: row\n  children: []\n", "utf-8");
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);
      delete process.env.PACE_CONFIG;
      const read = readConfigSource(resolveConfigPath(undefined));
      expect(read?.usedConfigPath).toBe(examplePath);
      expect(read?.raw).toContain("direction: row");
    } finally {
      process.chdir(cwd);
      if (fs.existsSync(examplePath)) fs.unlinkSync(examplePath);
    }
  });

  test("resolveConfigPath treats preset-like PACE_CONFIG as explicit when resolved", () => {
    const presetPath = path.join(tmpDir, "config.tech-news.yaml");
    fs.writeFileSync(presetPath, "layout:\n  direction: row\n  children: []\n", "utf-8");
    const cwd = process.cwd();
    try {
      process.chdir(tmpDir);
      const resolved = resolveConfigPath("tech-news");
      expect(resolved.path).toBe(presetPath);
      expect(resolved.explicit).toBe(true);
    } finally {
      process.chdir(cwd);
      if (fs.existsSync(presetPath)) fs.unlinkSync(presetPath);
    }
  });

  test("accepts valid image widget in layout", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/badge.svg
      alt: "Status badge"
      object_fit: cover
      max_height: "200px"
      link: https://example.com
      flex: 0.3
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts minimal image widget (image only)", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects image widget with empty image url", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: ""
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: layout.children\[0\].image must be a non-empty string/);
  });

  test("rejects image widget with unknown field", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      typo_field: true
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].typo_field is not a valid image widget field/,
    );
  });

  test("rejects image widget with invalid object_fit", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      object_fit: stretch
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].object_fit must be one of: cover, contain, fill, none/,
    );
  });

  test("rejects image widget with unsafe link scheme", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      link: "javascript:alert(1)"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].link has disallowed scheme "javascript"/,
    );
  });

  test("accepts image widget with http://localhost link", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      link: "http://localhost:3000/dashboard"
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects image widget with non-localhost http link", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      link: "http://example.com/page"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].link has disallowed scheme "http"/,
    );
  });

  test("image widget does not conflict with panel discriminator", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
    - panel: news
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  // Iframe widget validation
  test("accepts valid iframe widget with all fields", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://grafana.local/d/abc
      title: System Metrics
      flex: 2
      aspect_ratio: "16/9"
      sandbox: "allow-scripts allow-same-origin allow-forms"
      allow: "fullscreen"
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts minimal iframe widget (iframe only)", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts iframe widget with height", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      height: "400px"
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts iframe widget with http://localhost", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: http://localhost:3000/dashboard
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects iframe widget with unsafe URL", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: http://example.com/embed
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].iframe has disallowed scheme "http"/,
    );
  });

  test("rejects iframe widget with empty iframe URL", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: ""
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: layout.children\[0\].iframe must be a non-empty URL string/);
  });

  test("rejects iframe widget with unknown field", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      typo_field: true
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].typo_field is not a valid iframe widget field/,
    );
  });

  test("rejects iframe widget with invalid aspect_ratio format", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      aspect_ratio: "16:9"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].aspect_ratio must match the format "N\/N"/,
    );
  });

  test("rejects iframe widget with non-numeric aspect_ratio", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      aspect_ratio: "wide"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].aspect_ratio must match the format "N\/N"/,
    );
  });

  test("rejects iframe widget with invalid height format", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      height: "400"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].height must be a valid CSS length/,
    );
  });

  test("rejects iframe widget with non-string height", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      height: 400
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].height must be a valid CSS length/,
    );
  });

  test("accepts iframe widget with various CSS length units", () => {
    for (const height of ["400px", "20rem", "15em", "50vh", "100%"]) {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      height: "${height}"
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    }
  });

  test("warns about invalid sandbox tokens", async () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      sandbox: "allow-scripts bogus-token allow-forms"
`;
    setConfig(yaml);
    await spyConsole(["warn"], async ({ warn }) => {
      expect(() => loadConfig()).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("bogus-token"),
      );
    });
  });

  test("iframe widget alongside panels", () => {
    const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      title: Dashboard
    - panel: news
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  // Text widget validation
  test("accepts valid text widget with all fields", () => {
    const yaml = `
adapters:
  - type: hackernews
layout:
  direction: row
  children:
    - text: "Hello world"
      format: markdown
      title: Notes
      flex: 2
    - panel: news
      source: hackernews
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts minimal text widget (text only)", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "Just some text"
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts text widget with format: plain", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "Plain text"
      format: plain
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("accepts text widget with format: html", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "<em>Hello</em>"
      format: html
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });

  test("rejects text widget with empty text", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: ""
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].text must be a non-empty string/,
    );
  });

  test("rejects text widget with invalid format", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "Hello"
      format: rtf
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].format must be one of/,
    );
  });

  test("rejects text widget with unknown field", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "Hello"
      bogus: true
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].bogus is not a valid text widget field/,
    );
  });

  test("rejects text widget with empty title", () => {
    const yaml = `
layout:
  direction: row
  children:
    - text: "Hello"
      title: ""
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /config: layout.children\[0\].title must be a non-empty string/,
    );
  });

  test("text widget alongside panels and other widgets", () => {
    const yaml = `
adapters:
  - type: hackernews
layout:
  direction: row
  children:
    - text: "Welcome note"
      title: About
    - panel: news
      source: hackernews
    - text: "## Changelog"
      format: markdown
`;
    setConfig(yaml);
    expect(() => loadConfig()).not.toThrow();
  });
});

  describe("sanitizeSandboxTokens", () => {
    test("passes through valid tokens", () => {
      expect(sanitizeSandboxTokens("allow-scripts allow-same-origin", "test")).toBe(
        "allow-scripts allow-same-origin",
      );
    });

    test("strips invalid tokens", async () => {
      await spyConsole(["warn"], async ({ warn }) => {
        const result = sanitizeSandboxTokens("allow-scripts invalid-token allow-forms", "test");
        expect(result).toBe("allow-scripts allow-forms");
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining("invalid-token"),
        );
      });
    });

    test("returns empty string when all tokens are invalid", async () => {
      await spyConsole(["warn"], async ({ warn }) => {
        const result = sanitizeSandboxTokens("bad-token another-bad", "test");
        expect(result).toBe("");
        expect(warn).toHaveBeenCalledTimes(2);
      });
    });

    test("handles extra whitespace", () => {
      expect(sanitizeSandboxTokens("  allow-scripts   allow-forms  ", "test")).toBe(
        "allow-scripts allow-forms",
      );
    });

    test("validates all known sandbox tokens", () => {
      const allTokens = [
        "allow-downloads", "allow-forms", "allow-modals",
        "allow-orientation-lock", "allow-pointer-lock", "allow-popups",
        "allow-popups-to-escape-sandbox", "allow-presentation",
        "allow-same-origin", "allow-scripts", "allow-top-navigation",
        "allow-top-navigation-by-user-activation",
        "allow-top-navigation-to-custom-protocols",
      ];
      expect(sanitizeSandboxTokens(allTokens.join(" "), "test")).toBe(allTokens.join(" "));
    });
  });

  describe("validateSafeUrl", () => {
    test("accepts https URLs", () => {
      expect(() => validateSafeUrl("https://example.com", "test")).not.toThrow();
    });

    test("accepts http://localhost", () => {
      expect(() => validateSafeUrl("http://localhost:3000", "test")).not.toThrow();
    });

    test("accepts http://127.0.0.1", () => {
      expect(() => validateSafeUrl("http://127.0.0.1:8080", "test")).not.toThrow();
    });

    test("accepts http://[::1]", () => {
      expect(() => validateSafeUrl("http://[::1]:9090", "test")).not.toThrow();
    });

    test("rejects http to non-localhost", () => {
      expect(() => validateSafeUrl("http://example.com", "test")).toThrow(
        /config: test has disallowed scheme "http"/,
      );
    });

    test("rejects javascript scheme", () => {
      expect(() => validateSafeUrl("javascript:alert(1)", "test")).toThrow(
        /config: test has disallowed scheme "javascript"/,
      );
    });

    test("rejects ftp scheme", () => {
      expect(() => validateSafeUrl("ftp://files.example.com", "test")).toThrow(
        /config: test has disallowed scheme "ftp"/,
      );
    });

    test("rejects non-string input", () => {
      expect(() => validateSafeUrl(42, "test")).toThrow(
        /config: test must be a non-empty URL string/,
      );
    });

    test("rejects empty string", () => {
      expect(() => validateSafeUrl("", "test")).toThrow(
        /config: test must be a non-empty URL string/,
      );
    });

    test("rejects invalid URL", () => {
      expect(() => validateSafeUrl("not a url", "test")).toThrow(
        /config: test is not a valid URL/,
      );
    });

    test("rejects data: URI", () => {
      expect(() => validateSafeUrl("data:text/html,<h1>hi</h1>", "test")).toThrow(
        /config: test has disallowed scheme "data"/,
      );
    });

    test("rejects http with userinfo targeting non-localhost", () => {
      expect(() => validateSafeUrl("http://localhost@evil.com/api", "test")).toThrow(
        /config: test has disallowed scheme "http"/,
      );
    });

    test("accepts https with userinfo", () => {
      expect(() => validateSafeUrl("https://user:pass@example.com/api", "test")).not.toThrow();
    });

    test("rejects blob: URI", () => {
      expect(() => validateSafeUrl("blob:https://example.com/uuid", "test")).toThrow(
        /config: test has disallowed scheme "blob"/,
      );
    });

    test("rejects https:// with no host", () => {
      // "https://" alone is not a valid URL (no host)
      expect(() => validateSafeUrl("https://", "test")).toThrow(
        /config: test is not a valid URL/,
      );
    });

    test("accepts https:///path (URL constructor treats 'path' as hostname)", () => {
      // "https:///path" is parsed by URL as hostname="path", which is valid https
      expect(() => validateSafeUrl("https:///path", "test")).not.toThrow();
    });

    test("accepts HTTPS://EXAMPLE.COM (uppercase scheme)", () => {
      // URL constructor normalizes scheme to lowercase
      expect(() => validateSafeUrl("HTTPS://EXAMPLE.COM", "test")).not.toThrow();
    });

    test("accepts https with port", () => {
      expect(() => validateSafeUrl("https://example.com:8080/path", "test")).not.toThrow();
    });

    test("accepts https with query string and fragment", () => {
      expect(() => validateSafeUrl("https://example.com/path?key=value&b=2#section", "test")).not.toThrow();
    });
  });

  describe("config validation edge cases", () => {
    let tmpDir: string;
    let cfgPath: string;
    let origEnv: string | undefined;

    beforeEach(() => {
      origEnv = process.env.PACE_CONFIG;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-cfg-edge-"));
      cfgPath = path.join(tmpDir, "config.yaml");
    });

    afterEach(() => {
      process.env.PACE_CONFIG = origEnv;
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    function setConfig(yamlContent: string) {
      fs.writeFileSync(cfgPath, yamlContent, "utf-8");
      process.env.PACE_CONFIG = cfgPath;
    }

    test("rejects node with both image and text keys (mixed discriminators)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      text: "Hello"
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(/config: layout.children\[0\] has conflicting keys: image, text/);
    });

    test("rejects node with panel and image keys (mixed discriminators)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - panel: news
      image: https://example.com/logo.png
      source: all
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(/config: layout.children\[0\] has conflicting keys: panel, image/);
    });

    test("rejects empty object {} as layout node (no discriminator)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - {}
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\] must define one of: panel, direction, image, text, iframe/,
      );
    });

    test("accepts widgets as children of a container", () => {
      const yaml = `
layout:
  direction: row
  children:
    - direction: column
      children:
        - image: https://example.com/logo.png
        - text: "Hello"
        - iframe: https://example.com/embed
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    });

    test("accepts widgets 3+ levels deep in containers", () => {
      const yaml = `
layout:
  direction: row
  children:
    - direction: column
      children:
        - direction: row
          children:
            - direction: column
              children:
                - image: https://example.com/deep.png
                  alt: "Deep image"
                - text: "Deeply nested text"
                  format: markdown
                - iframe: https://example.com/deep-embed
                  title: "Deep iframe"
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    });

    test("counter adapter with empty headers object is valid", () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: value
      headers: {}
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    });

    test("iframe with empty sandbox string is rejected", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      sandbox: ""
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\].sandbox must be a non-empty string/,
      );
    });

    test("rejects widget with negative flex value", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      flex: -1
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\].flex must be a positive number/,
      );
    });

    test("rejects panel with negative flex value", () => {
      const yaml = `
layout:
  direction: row
  children:
    - panel: news
      source: all
      flex: -1
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\].flex must be a positive number/,
      );
    });

    test("rejects text widget with zero flex", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "Hello"
      flex: 0
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\].flex must be a positive number/,
      );
    });

    test("rejects iframe widget with negative flex", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      flex: -0.5
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /config: layout.children\[0\].flex must be a positive number/,
      );
    });

    test("rejects node with direction and iframe keys (mixed discriminators)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - direction: column
      iframe: https://example.com/embed
      children: []
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(/config: layout.children\[0\] has conflicting keys: direction, iframe/);
    });
  });

  describe("common user mistakes with helpful error messages", () => {
    let tmpDir: string;
    let cfgPath: string;
    let origEnv: string | undefined;

    beforeEach(() => {
      origEnv = process.env.PACE_CONFIG;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-cfg-mistakes-"));
      cfgPath = path.join(tmpDir, "config.yaml");
    });

    afterEach(() => {
      process.env.PACE_CONFIG = origEnv;
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    function setConfig(yamlContent: string) {
      fs.writeFileSync(cfgPath, yamlContent, "utf-8");
      process.env.PACE_CONFIG = cfgPath;
    }

    // --- Image widget common mistakes ---

    test('image widget: using "img" instead of "image" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - img: https://example.com/logo.png
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has unknown key "img"; did you mean "image"/,
      );
    });

    test('image widget: using "src" instead of "image" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - src: https://example.com/logo.png
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has unknown key "src"; did you mean "image"/,
      );
    });

    test('image widget: using "image" inside a panel node rejects with conflicting keys', () => {
      const yaml = `
layout:
  direction: row
  children:
    - panel: news
      image: https://example.com/logo.png
      source: all
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has conflicting keys: panel, image/,
      );
    });

    test('image widget: using "object-fit" (CSS) instead of "object_fit" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      object-fit: cover
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /object-fit is not a valid image widget field; did you mean "object_fit"/,
      );
    });

    // --- Text widget common mistakes ---

    test('text widget: using "content" instead of "text" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - content: "Hello world"
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has unknown key "content"; did you mean "text"/,
      );
    });

    test('text widget: using "markdown: true" instead of "format: markdown" suggests format', () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "# Hello"
      markdown: true
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /markdown is not a valid text widget field; did you mean "format \(use format: markdown instead of markdown: true\)"/,
      );
    });

    test("text widget: very long multiline YAML text parses correctly", () => {
      const longText = "Line " + "x".repeat(5000);
      const yaml = `
layout:
  direction: row
  children:
    - text: "${longText}"
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    });

    test("text widget: using html content without format works (defaults to plain)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "<h1>Hello</h1><p>World</p>"
`;
      setConfig(yaml);
      expect(() => loadConfig()).not.toThrow();
    });

    // --- Iframe widget common mistakes ---

    test('iframe widget: using "url" instead of "iframe" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - url: https://grafana.local/d/abc
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has unknown key "url"; did you mean "iframe"/,
      );
    });

    test("iframe widget: using http:// for non-localhost URL rejects with scheme error", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: http://grafana.company.com/d/abc
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /has disallowed scheme "http"/,
      );
    });

    test("iframe widget: missing // in URL (https:example.com) rejects as invalid URL", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: "https:example.com"
`;
      setConfig(yaml);
      // The URL constructor may parse "https:example.com" successfully but with unexpected results;
      // either way the validator should not silently accept a malformed URL
      try {
        setConfig(yaml);
        loadConfig();
        // If it doesn't throw, the URL constructor somehow parsed it. Let's check what happens.
      } catch (e: unknown) {
        const msg = (e as Error).message;
        // Should mention URL-related error
        expect(msg).toMatch(/config:/);
      }
    });

    test('iframe widget: using "ratio" instead of "aspect_ratio" suggests correct key', () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      ratio: "16/9"
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /ratio is not a valid iframe widget field; did you mean "aspect_ratio"/,
      );
    });

    // --- Bookmarks adapter common mistakes ---

    test('bookmarks adapter: using "links" instead of "items" suggests correct param', () => {
      const yaml = `
adapters:
  - type: bookmarks
    params:
      links:
        - title: Example
          url: https://example.com
layout:
  direction: row
  children:
    - panel: bookmarks
      source: bookmarks
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /params\.links is not a valid bookmarks param; did you mean "items"/,
      );
    });

    test("bookmarks adapter: putting title/url directly in params (missing items wrapper)", () => {
      const yaml = `
adapters:
  - type: bookmarks
    params:
      title: Example
      url: https://example.com
layout:
  direction: row
  children:
    - panel: bookmarks
      source: bookmarks
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /is not a valid bookmarks param/,
      );
    });

    test("bookmarks adapter: empty items array is accepted (runtime produces warning)", () => {
      const yaml = `
adapters:
  - type: bookmarks
    params:
      items: []
layout:
  direction: row
  children:
    - panel: bookmarks
      source: bookmarks
`;
      setConfig(yaml);
      // Empty items is valid at config time (adapter warns at runtime)
      expect(() => loadConfig()).not.toThrow();
    });

    // --- Counter adapter common mistakes ---

    test('counter adapter: using "path" instead of "json_path" suggests correct param', () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      path: data.count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /params\.path is not a valid counter param; did you mean "json_path"/,
      );
    });

    test('counter adapter: using "endpoint" instead of "url" suggests correct param', () => {
      const yaml = `
adapters:
  - type: counter
    params:
      endpoint: https://api.example.com/count
      json_path: data.count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /params\.endpoint is not a valid counter param; did you mean "url"/,
      );
    });

    test('counter adapter: json_path starting with "$" gives helpful hint', () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: "$.data.count"
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /json_path must be a valid dot-notation path \(do not use JSONPath "\$\." prefix; use plain dot notation like "data\.count"\)/,
      );
    });

    test("counter adapter: missing json_path gives clear required error", () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /json_path is required for counter adapter/,
      );
    });

    test('counter adapter: display: "stats" instead of display: "counter" gives enum error', () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: data.count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: stats
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        /display must be one of: counter/,
      );
    });
  });

  describe("env var expansion in widget configs", () => {
    let tmpDir: string;
    let cfgPath: string;
    let origPaceConfig: string | undefined;
    let savedEnv: Record<string, string | undefined>;

    function setConfig(yamlContent: string) {
      fs.writeFileSync(cfgPath, yamlContent, "utf-8");
      process.env.PACE_CONFIG = cfgPath;
    }

    beforeEach(() => {
      origPaceConfig = process.env.PACE_CONFIG;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-envvar-test-"));
      cfgPath = path.join(tmpDir, "config.yaml");
      savedEnv = {
        PACE_TEST_HOME: process.env.PACE_TEST_HOME,
        PACE_TEST_TOKEN: process.env.PACE_TEST_TOKEN,
        PACE_TEST_VAR: process.env.PACE_TEST_VAR,
        PACE_TEST_URL: process.env.PACE_TEST_URL,
      };
      process.env.PACE_TEST_HOME = "/home/testuser";
      process.env.PACE_TEST_TOKEN = "secret123";
      process.env.PACE_TEST_VAR = "resolved-value";
      process.env.PACE_TEST_URL = "https://embed.example.com";
    });

    afterEach(() => {
      process.env.PACE_CONFIG = origPaceConfig;
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("image URL with env var gets expanded", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "\${PACE_TEST_HOME}/logo.png"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { image: string };
      expect(child.image).toBe("/home/testuser/logo.png");
    });

    test("image link with env var gets expanded", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/img.png"
      link: "\${PACE_TEST_URL}/details"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { image: string; link: string };
      expect(child.link).toBe("https://embed.example.com/details");
    });

    test("text widget content with env var gets expanded", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "Welcome to \${PACE_TEST_VAR}"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toBe("Welcome to resolved-value");
    });

    test("iframe URL with env var gets expanded", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: "\${PACE_TEST_URL}/embed"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { iframe: string };
      expect(child.iframe).toBe("https://embed.example.com/embed");
    });

    test("counter URL with env var gets expanded at config level", () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: "\${PACE_TEST_URL}/api/count"
      json_path: data.count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const adapter = cfg.adapters[0];
      expect((adapter.params as Record<string, unknown>).url).toBe(
        "https://embed.example.com/api/count",
      );
    });

    test("counter headers with env var get expanded at config level", () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: data.count
      headers:
        Authorization: "Bearer \${PACE_TEST_TOKEN}"
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const headers = (cfg.adapters[0].params as Record<string, unknown>)
        .headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer secret123");
    });

    test("nonexistent env var expands to empty string with warning", async () => {
      await spyConsole(["warn"], async ({ warn }) => {
        const yaml = `
layout:
  direction: row
  children:
    - text: "prefix-\${PACE_NONEXISTENT_TEST_XYZ}-suffix"
`;
        setConfig(yaml);
        const cfg = loadConfig();
        const child = cfg.layout.children[0] as { text: string };
        expect(child.text).toBe("prefix--suffix");
        const warnCalls = warn.mock.calls.map((c) => String(c[0]));
        expect(
          warnCalls.some((w) =>
            w.includes("PACE_NONEXISTENT_TEST_XYZ") && w.includes("unset"),
          ),
        ).toBe(true);
      });
    });

    test("multiple env vars in one string all expand", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "\${PACE_TEST_HOME}/\${PACE_TEST_VAR}/\${PACE_TEST_TOKEN}"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toBe("/home/testuser/resolved-value/secret123");
    });

    test("real PATH env var resolves in counter headers at config level", () => {
      const realPath = process.env.PATH;
      expect(realPath).toBeTruthy(); // PATH should always be set
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: data.count
      headers:
        X-Path: "\${PATH}"
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const headers = (cfg.adapters[0].params as Record<string, unknown>)
        .headers as Record<string, string>;
      expect(headers["X-Path"]).toBe(realPath);
    });

    test("env var expansion does not happen on non-string values", () => {
      // flex is a number, should not be treated as string for env expansion
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/img.png"
      flex: 2
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { image: string; flex: number };
      expect(child.flex).toBe(2);
      expect(typeof child.flex).toBe("number");
    });
  });

  describe("YAML edge cases in widget configs", () => {
    let tmpDir: string;
    let cfgPath: string;
    let origPaceConfig: string | undefined;

    function setConfig(yamlContent: string) {
      fs.writeFileSync(cfgPath, yamlContent, "utf-8");
      process.env.PACE_CONFIG = cfgPath;
    }

    beforeEach(() => {
      origPaceConfig = process.env.PACE_CONFIG;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-yaml-test-"));
      cfgPath = path.join(tmpDir, "config.yaml");
    });

    afterEach(() => {
      process.env.PACE_CONFIG = origPaceConfig;
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("multi-line text with YAML block scalar (|)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: |
        Line one
        Line two
        Line three
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toContain("Line one");
      expect(child.text).toContain("Line two");
      expect(child.text).toContain("Line three");
      // Block scalar preserves newlines
      expect(child.text).toMatch(/Line one\nLine two\nLine three/);
    });

    test("multi-line text with YAML folded scalar (>)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: >
        This is a
        long paragraph
        that folds.
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      // Folded scalar joins lines with spaces
      expect(child.text).toMatch(/This is a long paragraph that folds\./);
    });

    test("text with YAML special characters (colon, hash, at)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "Status: OK # not a comment @ here"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toBe("Status: OK # not a comment @ here");
    });

    test("image URL with query params (needs YAML quoting)", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/img.png?width=400&height=300"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { image: string };
      expect(child.image).toBe("https://example.com/img.png?width=400&height=300");
    });

    test("empty string alt on image widget is rejected", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/img.png"
      alt: ""
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(/alt must be a non-empty string/);
    });

    test("omitting optional alt is fine", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/img.png"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { image: string; alt?: string };
      expect(child.image).toBe("https://example.com/img.png");
      expect(child.alt).toBeUndefined();
    });

    test("iframe URL with fragment and query", () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: "https://example.com/embed?theme=dark&lang=en#section"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { iframe: string };
      expect(child.iframe).toBe("https://example.com/embed?theme=dark&lang=en#section");
    });

    test("text with unicode and emoji characters", () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "Hello World"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toBe("Hello World");
    });

    test("text with unquoted colon requires careful YAML", () => {
      // In YAML, bare "key: value" is a mapping. Inside a sequence value
      // that's already a string context, colons after space can be tricky.
      const yaml = `
layout:
  direction: row
  children:
    - text: "http://example.com:8080/path"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const child = cfg.layout.children[0] as { text: string };
      expect(child.text).toBe("http://example.com:8080/path");
    });

    test("deeply nested widget in multi-level containers", () => {
      const yaml = `
layout:
  direction: row
  children:
    - direction: column
      children:
        - direction: row
          children:
            - text: "Deep nesting works"
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const outer = cfg.layout.children[0] as { direction: string; children: unknown[] };
      const inner = outer.children[0] as { direction: string; children: unknown[] };
      const widget = inner.children[0] as { text: string };
      expect(widget.text).toBe("Deep nesting works");
    });

    test("widgets with explicit flex values parse as numbers", () => {
      const yaml = `
layout:
  direction: row
  children:
    - image: "https://example.com/a.png"
      flex: 2
    - text: "Hello"
      flex: 0.5
    - iframe: "https://example.com"
      flex: 3
`;
      setConfig(yaml);
      const cfg = loadConfig();
      const children = cfg.layout.children as Array<{ flex?: number }>;
      expect(children[0].flex).toBe(2);
      expect(children[1].flex).toBe(0.5);
      expect(children[2].flex).toBe(3);
    });

    test("YAML anchors rejected at top level (strict key validation)", () => {
      // YAML anchors produce extra top-level keys which the config validator rejects
      const yaml = `
common_headers: &common
  Accept: application/json

adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: data.count
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(/common_headers is not a valid top-level field/);
    });
  });

  describe("config reload behavior", () => {
    let tmpDir: string;
    let cfgPath: string;
    let origPaceConfig: string | undefined;

    function setConfig(yamlContent: string) {
      fs.writeFileSync(cfgPath, yamlContent, "utf-8");
      process.env.PACE_CONFIG = cfgPath;
    }

    beforeEach(() => {
      origPaceConfig = process.env.PACE_CONFIG;
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pace-reload-test-"));
      cfgPath = path.join(tmpDir, "config.yaml");
    });

    afterEach(() => {
      process.env.PACE_CONFIG = origPaceConfig;
      if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    test("loadConfig reads from disk each time (no caching)", () => {
      const yaml1 = `
layout:
  direction: row
  children:
    - text: "Version 1"
`;
      setConfig(yaml1);
      const cfg1 = loadConfig();
      expect((cfg1.layout.children[0] as { text: string }).text).toBe("Version 1");

      const yaml2 = `
layout:
  direction: row
  children:
    - text: "Version 2"
`;
      setConfig(yaml2);
      const cfg2 = loadConfig();
      expect((cfg2.layout.children[0] as { text: string }).text).toBe("Version 2");
    });

    test("loadConfig picks up new adapters on re-read", () => {
      const yaml1 = `
adapters:
  - type: hackernews
layout:
  direction: row
  children:
    - panel: news
      source: hackernews
`;
      setConfig(yaml1);
      const cfg1 = loadConfig();
      expect(cfg1.adapters).toHaveLength(1);

      const yaml2 = `
adapters:
  - type: hackernews
  - type: lobsters
layout:
  direction: row
  children:
    - panel: news
      source: all
`;
      setConfig(yaml2);
      const cfg2 = loadConfig();
      expect(cfg2.adapters).toHaveLength(2);
    });
  });
});
