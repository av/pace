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
  });
});
