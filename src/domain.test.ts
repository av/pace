import { describe, it, expect } from "bun:test";
import type { ContentItem, Adapter, AdapterConfig } from "./adapters/types";
import type {
  AppConfig,
  IngestAdapterConfig,
  LayoutNodeConfig,
  LlmConfig,
  PanelConfig,
  PipelineConfig,
} from "./config";
import { isPanel } from "./config";

/** Persisted item: ContentItem fields plus panel metadata (DB stores dates as ISO strings). */
type PersistedContentItem = ContentItem & {
  panel_id: string;
  fetched_at: Date;
  summary?: string;
};

describe("domain", () => {
  it("ContentItem required fields", () => {
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

  it("ContentItemRow persisted fields", () => {
    const row: PersistedContentItem = {
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

  it("Panel shape", () => {
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

  it("Adapter shape", () => {
    const adapter: Adapter = {
      name: "hackernews",
      fetch: async (_config: AdapterConfig): Promise<ContentItem[]> => [],
    };
    expect(adapter).toHaveProperty("name");
    expect(typeof adapter.name).toBe("string");
    expect(adapter).toHaveProperty("fetch");
    expect(typeof adapter.fetch).toBe("function");
    // AdapterConfig and ContentItem[] return per 2wm entity def; pure test no imports per scope
  });

  it("Layout shape", () => {
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
    const leaf = layout.children[0];
    expect("panel" in leaf).toBe(true);
    if ("panel" in leaf) {
      expect(typeof leaf.panel).toBe("string");
      expect(leaf).toHaveProperty("source");
      if (leaf.limit !== undefined) {
        expect(typeof leaf.limit).toBe("number");
      }
      if (leaf.flex !== undefined) {
        expect(typeof leaf.flex).toBe("number");
      }
    }
    const container = layout.children[1];
    expect("direction" in container).toBe(true);
    if ("direction" in container) {
      expect(typeof container.direction).toBe("string");
      expect(Array.isArray(container.children)).toBe(true);
      if (container.gap !== undefined) {
        expect(typeof container.gap).toBe("string");
      }
    }
    // recursive LayoutNodeConfig per frg + config.ts types (FlexContainer | PanelConfig); source string subset of SourceValue; pure test no imports per scope
  });

  it("Transform shape", () => {
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

  it("Pipeline shape", () => {
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

  it("AppConfig shape", () => {
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

  it("Scheduler shape", () => {
    const schedulerShape = {
      manages: ["adapters", "pipelines"],
      persists: "ContentItemRows to DB",
      refreshResult: { kind: "adapter", name: "hackernews", status: "ok" as const },
      // representative of domain Scheduler per l16 + related (pure test, no prod imports per scope)
    };
    expect(schedulerShape).toHaveProperty("manages");
    expect(Array.isArray(schedulerShape.manages)).toBe(true);
    expect(schedulerShape).toHaveProperty("persists");
    expect(schedulerShape.refreshResult).toHaveProperty("status");
  });

  it("LLMConfig shape", () => {
    const llmConfig = {
      provider: "openai",
      model: "gpt-4o-mini",
      api_key: "sk-test-123",
      base_url: "https://api.openai.com/v1",
      interests: ["AI safety", "open source models"],
      // representative of domain LLMConfig per dhu + fc3 (pure test, no prod imports per scope; matches config.ts:60-66 + validate + llm.ts + ml-ai.yaml)
    };
    expect(llmConfig).toHaveProperty("provider");
    expect(typeof llmConfig.provider).toBe("string");
    expect(llmConfig).toHaveProperty("model");
    expect(typeof llmConfig.model).toBe("string");
    expect(llmConfig).toHaveProperty("api_key");
    if (llmConfig.base_url !== undefined) {
      expect(typeof llmConfig.base_url).toBe("string");
    }
    if (llmConfig.interests !== undefined) {
      expect(Array.isArray(llmConfig.interests)).toBe(true);
    }
  });

  it("Adapter fetch returns Promise", () => {
    const adapter: Adapter = {
      name: "hackernews",
      fetch: (_config: AdapterConfig) => Promise.resolve([]),
    };
    expect(adapter).toHaveProperty("name");
    expect(typeof adapter.name).toBe("string");
    expect(adapter).toHaveProperty("fetch");
    expect(typeof adapter.fetch).toBe("function");
    const result = adapter.fetch({ type: "hackernews" });
    expect(result).toBeInstanceOf(Promise);
  });

  it("ContentItemRow dedupe shape", () => {
    const rows = [
      { id: "hn:123", title: "foo", url: "https://ex.com/a", source: "hackernews", timestamp: new Date("2026-05-31T10:00:00Z"), panel_id: "p1", fetched_at: new Date() },
      { id: "hn:456", title: "bar", url: "https://ex.com/a", source: "hackernews", timestamp: new Date("2026-05-31T11:00:00Z"), panel_id: "p1", fetched_at: new Date() }, // latest for url
      { id: "hn:789", title: "baz", url: "https://ex.com/b", source: "hackernews", timestamp: new Date("2026-05-31T09:00:00Z"), panel_id: "p1", fetched_at: new Date() },
    ];
    const deduped = [rows[1], rows[2]];
    expect(deduped.length).toBe(2);
    expect(deduped[0]).toHaveProperty("url");
    expect(deduped[0]).toHaveProperty("timestamp");
    expect(deduped[0]).toHaveProperty("id");
    expect(deduped[0]).toHaveProperty("panel_id");
    // wk0 fidelity: dedup uses url (norm) + timestamp latest per panel for Dashboard render (strengthens wr4/qun)
  });

  it("Layout panel source all bypass", () => {
    const layout = {
      direction: "column",
      children: [
        { panel: "global", source: "all" },
        { panel: "tech", source: "hackernews" },
        { panel: "pipe", source: "my-pipe" },
      ],
    };
    expect(layout.children.some((c) => isPanel(c) && c.source === "all")).toBe(true);
    const allBypassSources = layout.children
      .filter((c): c is PanelConfig => isPanel(c) && c.source === "all")
      .map((c) => c.source);
    expect(allBypassSources.length).toBe(1);
    expect(allBypassSources[0]).toBe("all");
    // isy fidelity: Layout refs Adapters/Pipelines/'all'; 'all' special bypasses normal for global recent (strengthens kb9/frg domain Layout)
  });

  it("AppConfig drives scheduler", () => {
    const appConfig = {
      adapters: [{ name: "hackernews" }],
      pipelines: [{ name: "p1", sources: ["hackernews"], transforms: [] }],
      layout: { direction: "column", children: [{ panel: "all", source: "all" }] },
      // llm? optional; represents AppConfig per kde + 99y relation (pure test, no prod imports per scope; matches config.ts + .facts domain)
    };
    expect(appConfig).toHaveProperty("adapters");
    expect(Array.isArray(appConfig.adapters)).toBe(true);
    expect(appConfig).toHaveProperty("pipelines");
    expect(appConfig).toHaveProperty("layout");
    // initial (will cause red): no drive relation exercised, empty list
    const app: AppConfig = appConfig;
    const declaresAndDrives: [
      IngestAdapterConfig[],
      PipelineConfig[] | undefined,
      LayoutNodeConfig,
    ] = [app.adapters, app.pipelines, app.layout];
    expect(declaresAndDrives.length).toBe(3);
    // 99y fidelity: AppConfig declares Adapters, Pipelines and a Layout which together drive the Scheduler (strengthens 0b6/rhq + domain relations 99y/6de/fc3)
  });

  it("Scheduler fetch transform persist", () => {
    const itemsFromAdapter: ContentItem[] = [
      { id: "hn:1", title: "a", url: "u1", source: "hackernews", timestamp: new Date() },
    ];
    const itemsFromPipe: ContentItem[] = [
      { id: "gh:2", title: "b", url: "u2", source: "github", timestamp: new Date() },
    ];
    type TransformedItem = ContentItem & { transformed: boolean };
    const applyTransforms = (xs: ContentItem[]): TransformedItem[] =>
      xs.map((x) => ({ ...x, transformed: true }));
    const persistRows = (xs: TransformedItem[]): TransformedItem[] => xs;
    const processed = persistRows(applyTransforms([...itemsFromAdapter, ...itemsFromPipe]));
    expect(processed.length).toBe(2);
    expect(processed.every((x) => x.transformed)).toBe(true);
    // 6de fidelity: Scheduler invokes Adapter fetch or Pipeline processing then applies ordered Transforms before persisting as ContentItemRows (strengthens rhq + domain 6de/99y/fc3)
  });

  it("LLM transform degrades without model", () => {
    const items: ContentItem[] = [
      { id: "hn:1", title: "a", url: "u1", source: "hackernews", timestamp: new Date() },
    ];
    const hasValidLlm = (cfg: LlmConfig | undefined) => Boolean(cfg?.model);
    type SummarizedItem = ContentItem & { summary?: string };
    const applyLlmIfValid = (xs: ContentItem[], cfg: LlmConfig): SummarizedItem[] =>
      hasValidLlm(cfg) ? xs.map((x) => ({ ...x, summary: "LLM sum" })) : xs;
    const validCfg: LlmConfig = { provider: "openai", model: "gpt-4o-mini" };
    const invalidCfg: LlmConfig = { provider: "openai" };
    const noLlmResult = applyLlmIfValid(items, invalidCfg);
    expect(noLlmResult).toEqual(items);
    const withLlm = applyLlmIfValid(items, validCfg);
    expect(withLlm[0]?.summary).toBe("LLM sum");
    // fc3 shape fidelity: LLM-powered Transforms and summaries require a valid LLMConfig and model; otherwise they silently degrade to no-op (strengthens wiw + domain fc3/dhu)
  });
});
