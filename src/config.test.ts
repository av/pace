import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  normalizeSource,
  collectPanels,
  resolvePanelId,
  isPanel,
  isContainer,
  loadConfig,
  type PanelConfig,
  type LayoutNodeConfig,
} from "./config";

describe("config pure helpers", () => {
  test("isPanel detects PanelConfig and rejects containers", () => {
    const panel: PanelConfig = { panel: "p1", source: "all" };
    const container: LayoutNodeConfig = { direction: "row", children: [] };
    expect(isPanel(panel)).toBe(true);
    expect(isPanel(container)).toBe(false);
    expect(isPanel({ foo: 1 })).toBe(false);
    expect(isPanel(null)).toBe(false);
  });

  test("isContainer detects FlexContainerConfig and rejects panels", () => {
    const container = { direction: "column" as const, children: [] };
    const panel = { panel: "p", source: "all" };
    expect(isContainer(container)).toBe(true);
    expect(isContainer(panel)).toBe(false);
    expect(isContainer({ direction: "row" })).toBe(false);
  });

  test("normalizeSource handles string, string[], object, and mixed array", () => {
    expect(normalizeSource("rss")).toEqual([{ adapter: "rss" }]);
    expect(normalizeSource(["a", "b"])).toEqual([{ adapter: "a" }, { adapter: "b" }]);
    const obj = { adapter: "hn", params: { foo: 1 } };
    expect(normalizeSource(obj)).toEqual([obj]);
    const arr = ["s1", { adapter: "s2" }, "s3"];
    expect(normalizeSource(arr)).toEqual([{ adapter: "s1" }, { adapter: "s2" }, { adapter: "s3" }]);
  });

  test("collectPanels flattens nested layout tree to list of panels only", () => {
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

  test("resolvePanelId returns explicit id when present, else stable 8-char hex hash", () => {
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
});

describe("config validation via loadConfig (hermetic temp files)", () => {
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

  test("loadConfig succeeds for minimal valid config using 'all' source", () => {
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
    expect((cfg.layout as any).children[0].panel).toBe("testpanel");
  });

  test("rejects panel with empty panel name (validateLayoutNode)", () => {
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

  test("rejects source object with empty adapter (validateSource)", () => {
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

  test("rejects adapter entry with empty type (validateAdapterConfig)", () => {
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

  test("rejects adapter with empty name when provided (optional non-empty)", () => {
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

  test("rejects pipeline with empty name (validatePipelineConfig)", () => {
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

  test("rejects source string in pipeline with empty (inline in validatePipelineConfig)", () => {
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

  test("rejects transform with empty type (validateTransforms)", () => {
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

  test("rejects keyword-score with empty term (validateKeywordScoreEntries)", () => {
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

  test("rejects filter keywords list containing empty string (validateStringList)", () => {
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

  test("rejects latest with non-positive count (validatePositiveInteger)", () => {
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

  test("rejects unknown top-level key (validateTopLevelKeys)", () => {
    const yaml = `
foo: bar
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(/config: unknown top-level key "foo"/);
  });

  test("rejects filter with empty keywords list (validateStringList)", () => {
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

  test("rejects keyword-score with empty keywords list (validateKeywordScoreEntries)", () => {
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

  test("rejects filter with empty fields list (validateNonEmptyArray via fields)", () => {
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

  test("rejects cluster with non-positive min_cluster_size (validateOptionalPositiveInteger)", () => {
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

  test("rejects cluster with non-positive max_clusters and non-integer (validateOptionalPositiveInteger)", () => {
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

  test("rejects keyword-score with non-number min_score (validateOptionalFiniteNumber)", () => {
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

  test("rejects time-decay with non-finite recency_weight (validateOptionalFiniteNumber)", () => {
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
});
