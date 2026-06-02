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
    expect(() => loadConfig()).toThrow(/config: unknown top-level key "foo"/);
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
      chained: "pre\${${outerKey}}post"
layout:
  direction: row
  children:
    - panel: p
      source: all
`;
      setConfig(yaml);
      const cfg = loadConfig();
      expect(cfg.adapters[0]?.params?.chained).toBe("prexzypost");
    } finally {
      if (origOuter === undefined) { delete process.env[outerKey]; } else { process.env[outerKey] = origOuter; }
      if (origInner === undefined) { delete process.env[innerKey]; } else { process.env[innerKey] = origInner; }
    }
  });
});
});
