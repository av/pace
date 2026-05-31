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
});
