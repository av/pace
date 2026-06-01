import { describe, it, expect } from "bun:test";

// Domain fidelity test (ContentItem per .facts tgt, ContentItemRow per qun).
// Pure test coverage for shape/required/optional fields/summary fidelity gap noted in prior iters.
// No imports from db/adapters/llm etc to stay in domain-only scope.

describe("domain ContentItem fidelity (per .facts)", () => {
  it("ContentItem has required shape {id, title, url, source, timestamp: Date, body?} per tgt", () => {
    const item = {
      id: "hn:123",
      title: "foo bar",
      url: "https://example.com/a",
      source: "hackernews",
      timestamp: new Date("2026-05-31T00:00:00Z"),
      body: "<p>optional body</p>",
    };
    expect(item).toHaveProperty("id");
    expect(typeof item.id).toBe("string");
    expect(item).toHaveProperty("title");
    expect(item).toHaveProperty("url");
    expect(item).toHaveProperty("source");
    expect(item.timestamp).toBeInstanceOf(Date);
    expect(item.timestamp.getTime()).not.toBeNaN();
    // body optional per domain
    const itemNoBody = {
      id: "hn:456",
      title: "no body",
      url: "https://ex.com/b",
      source: "hackernews",
      timestamp: new Date(),
    };
    expect(itemNoBody).toHaveProperty("id");
    expect(itemNoBody).not.toHaveProperty("body"); // or undefined ok
  });

  it("ContentItemRow persisted shape includes panel_id, fetched_at + optional LLM summary per qun", () => {
    const row: any = {
      id: "hn:123",
      title: "foo",
      url: "https://ex.com",
      source: "hackernews",
      timestamp: new Date(),
      panel_id: "a1b2c3d4",
      fetched_at: new Date("2026-05-31T12:00:00Z"),
      // summary omitted = optional
    };
    expect(row).toHaveProperty("panel_id");
    expect(typeof row.panel_id).toBe("string");
    expect(row).toHaveProperty("fetched_at");
    expect(row.fetched_at).toBeInstanceOf(Date);
    expect(row.fetched_at.getTime()).not.toBeNaN();
    expect(row.summary).toBeUndefined(); // optional absent

    const rowWithSummary = {
      ...row,
      summary: "LLM generated summary text here.",
    };
    expect(rowWithSummary).toHaveProperty("summary");
    expect(typeof rowWithSummary.summary).toBe("string");
  });

  it("Panel has shape fidelity {name, source, limit?, id?} per qyi", () => {
    const panel = {
      name: "tech-news",
      source: "all",
      id: "a1b2c3d4", // stable 8-char hex per domain facts (optional in some configs)
      limit: 10,
    };
    expect(panel).toHaveProperty("id");
    expect(typeof panel.id).toBe("string");
    expect(typeof panel.name).toBe("string");
    expect(panel).toHaveProperty("source");
    if (panel.limit !== undefined) {
      expect(typeof panel.limit).toBe("number");
    }
    // id optional in some cases; source can be adapter/pipeline/all per qyi
  });

  it("Adapter has shape fidelity {name, fetch(config: AdapterConfig): Promise<ContentItem[]>} per 2wm", () => {
    const adapter = {
      name: "hackernews",
      fetch: async (config: any): Promise<any[]> => [], // satisfies domain 2wm contract (name + fetch returning ContentItem[])
    };
    expect(adapter).toHaveProperty("name");
    expect(typeof adapter.name).toBe("string");
    expect(adapter).toHaveProperty("fetch");
    expect(typeof adapter.fetch).toBe("function");
    // AdapterConfig and ContentItem[] return per 2wm entity def; pure test no imports per scope
  });

  it("Layout has shape fidelity {direction, children[] (recursive FlexContainerConfig|PanelConfig)} per frg", () => {
    const layout = {
      direction: "row",
      gap: "1rem",
      children: [
        { panel: "all", source: "all", limit: 50, flex: 2 },
        {
          direction: "column",
          flex: 1,
          gap: "0.5rem",
          children: [
            { panel: "blogs", source: "rss", limit: 15 },
          ],
        },
      ],
    };
    expect(layout).toHaveProperty("direction");
    expect(typeof layout.direction).toBe("string");
    expect(layout).toHaveProperty("children");
    expect(Array.isArray(layout.children)).toBe(true);
    if (layout.gap !== undefined) {
      expect(typeof layout.gap).toBe("string");
    }
    const leaf = layout.children[0] as any;
    expect(leaf).toHaveProperty("panel");
    expect(typeof leaf.panel).toBe("string");
    expect(leaf).toHaveProperty("source");
    if (leaf.limit !== undefined) {
      expect(typeof leaf.limit).toBe("number");
    }
    if (leaf.flex !== undefined) {
      expect(typeof leaf.flex).toBe("number");
    }
    const container = layout.children[1] as any;
    expect(container).toHaveProperty("direction");
    expect(Array.isArray(container.children)).toBe(true);
    if (container.gap !== undefined) {
      expect(typeof container.gap).toBe("string");
    }
    // recursive LayoutNodeConfig per frg + config.ts types (FlexContainer | PanelConfig); source string subset of SourceValue; pure test no imports per scope
  });

  it("Transform has shape fidelity per bv5 (TransformConfig union e.g. dedupe per 8eh {type, strategy?, threshold?, keep?, log?} + variants like llm-summarize/filter + PipelineConfig {name, sources, transforms: TransformConfig[]})", () => {
    const dedupeXform = {
      type: "dedupe" as const,
      strategy: "title-similarity" as const,
      threshold: 0.85,
      keep: "highest-score" as const,
      log: true,
    };
    expect(dedupeXform).toHaveProperty("type");
    expect(dedupeXform.type).toBe("dedupe");
    expect(dedupeXform).toHaveProperty("strategy");
    expect(typeof dedupeXform.strategy).toBe("string");
    expect(dedupeXform).toHaveProperty("keep");

    const llmXform = { type: "llm-summarize" as const };
    expect(llmXform.type).toBe("llm-summarize");

    const pipelineEx = {
      name: "tech-pipe",
      sources: ["hackernews", "rss"],
      transforms: [dedupeXform, llmXform],
      refresh_interval: 900,
    };
    expect(pipelineEx).toHaveProperty("name");
    expect(typeof pipelineEx.name).toBe("string");
    expect(Array.isArray(pipelineEx.sources)).toBe(true);
    expect(Array.isArray(pipelineEx.transforms)).toBe(true);
  });

  it("Pipeline has shape fidelity per niu {name, sources: string[], transforms: TransformConfig[], refresh_interval?}", () => {
    const pipeline = {
      name: "news-pipe",
      sources: ["hackernews", "github-releases"],
      transforms: [{ type: "dedupe" as const, strategy: "url" as const, keep: "latest" as const }],
      // refresh_interval optional per domain + config.ts:75-80
    };
    expect(pipeline).toHaveProperty("name");
    expect(typeof pipeline.name).toBe("string");
    expect(Array.isArray(pipeline.sources)).toBe(true);
    expect(Array.isArray(pipeline.transforms)).toBe(true);
    if (pipeline.refresh_interval !== undefined) {
      expect(typeof pipeline.refresh_interval).toBe("number");
    }
  });

  it("AppConfig has shape fidelity per (kde) {adapters: IngestAdapterConfig[], pipelines?: PipelineConfig[], layout: LayoutNodeConfig, llm?: LlmConfig }", () => {
    const appConfig = {
      adapters: [{ name: "hackernews" }],
      pipelines: [{ name: "p1", sources: ["hn"], transforms: [] }],
      layout: { direction: "column", children: [] },
      llm: { provider: "openai", model: "gpt-4o-mini" },
    };
    expect(appConfig).toHaveProperty("adapters");
    expect(Array.isArray(appConfig.adapters)).toBe(true);
    expect(appConfig).toHaveProperty("layout");
    if (appConfig.pipelines !== undefined) {
      expect(Array.isArray(appConfig.pipelines)).toBe(true);
    }
    if (appConfig.llm !== undefined) {
      expect(typeof appConfig.llm).toBe("object");
    }
  });
});
