import { describe, test, expect, spyOn, beforeEach, afterEach } from "bun:test";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import type { LayoutNodeConfig } from "./layout/types";

/**
 * Config-validation warnings for panels mixing a pipeline with its upstream
 * adapter: the pipeline's enriched copy shadows the raw item in the deduped
 * panel view, which is correct but surprising — the validator warns.
 */

function layoutWith(...panels: LayoutNodeConfig[]): LayoutNodeConfig {
  return { direction: "row", children: panels };
}

function pipelineWarnings(warnSpy: ReturnType<typeof spyOn>): string[] {
  return warnSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((msg: string) => msg.includes("alongside its upstream"));
}

describe("pipeline/upstream-adapter shared panel warning", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("warns when a panel lists a pipeline and its upstream adapter", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        pipelines: [{ name: "curated", sources: ["hn"], transforms: [] }],
        layout: layoutWith({ panel: "mixed", source: ["hn", "curated"] }),
      },
      DEFAULT_LAYOUT,
    );

    const warnings = pipelineWarnings(warnSpy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('panel "mixed"');
    expect(warnings[0]).toContain('pipeline "curated"');
    expect(warnings[0]).toContain('"hn"');
    expect(warnings[0]).toContain("shadows the raw item");
  });

  test("names every overlapping upstream adapter", () => {
    validateParsedConfig(
      {
        adapters: [
          { type: "hackernews", name: "hn" },
          { type: "lobsters", name: "blog" },
        ],
        pipelines: [
          { name: "curated", sources: ["hn", "blog"], transforms: [] },
        ],
        layout: layoutWith({
          panel: "mixed",
          source: ["hn", "blog", "curated"],
        }),
      },
      DEFAULT_LAYOUT,
    );

    const warnings = pipelineWarnings(warnSpy);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("adapters");
    expect(warnings[0]).toContain('"hn"');
    expect(warnings[0]).toContain('"blog"');
  });

  test("does not warn when pipeline and adapter live on separate panels", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        pipelines: [{ name: "curated", sources: ["hn"], transforms: [] }],
        layout: layoutWith(
          { panel: "raw", source: "hn" },
          { panel: "enriched", source: "curated" },
        ),
      },
      DEFAULT_LAYOUT,
    );

    expect(pipelineWarnings(warnSpy)).toHaveLength(0);
  });

  test("does not warn for a pipeline-only panel", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        pipelines: [{ name: "curated", sources: ["hn"], transforms: [] }],
        layout: layoutWith({ panel: "enriched", source: "curated" }),
      },
      DEFAULT_LAYOUT,
    );

    expect(pipelineWarnings(warnSpy)).toHaveLength(0);
  });

  test("does not warn when the co-listed adapter is not upstream of the pipeline", () => {
    validateParsedConfig(
      {
        adapters: [
          { type: "hackernews", name: "hn" },
          { type: "lobsters", name: "blog" },
        ],
        pipelines: [{ name: "curated", sources: ["hn"], transforms: [] }],
        layout: layoutWith(
          { panel: "mixed", source: ["blog", "curated"] },
          { panel: "raw", source: "hn" },
        ),
      },
      DEFAULT_LAYOUT,
    );

    expect(pipelineWarnings(warnSpy)).toHaveLength(0);
  });

  test("warns once per offending panel", () => {
    validateParsedConfig(
      {
        adapters: [
          { type: "hackernews", name: "hn" },
          { type: "lobsters", name: "blog" },
        ],
        pipelines: [
          { name: "curated", sources: ["hn"], transforms: [] },
          { name: "digest", sources: ["blog"], transforms: [] },
        ],
        layout: layoutWith(
          { panel: "one", source: ["hn", "curated"] },
          { panel: "two", source: ["blog", "digest"] },
        ),
      },
      DEFAULT_LAYOUT,
    );

    const warnings = pipelineWarnings(warnSpy);
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes('panel "one"'))).toBe(true);
    expect(warnings.some((w) => w.includes('panel "two"'))).toBe(true);
  });
});

function warningsContaining(warnSpy: ReturnType<typeof spyOn>, needle: string): string[] {
  return warnSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .filter((msg: string) => msg.includes(needle));
}

describe("shared-source warning", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  test("warns when multiple panels reference the same adapter", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        layout: layoutWith(
          { panel: "first", source: "hn" },
          { panel: "second", source: "hn" },
        ),
      },
      DEFAULT_LAYOUT,
    );

    const warnings = warningsContaining(warnSpy, "multiple panels share source");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"hn"');
    expect(warnings[0]).toContain('"first"');
    expect(warnings[0]).toContain('"second"');
  });

  test("no warning for distinct sources or source all", () => {
    validateParsedConfig(
      {
        adapters: [
          { type: "hackernews", name: "hn" },
          { type: "lobsters", name: "blog" },
        ],
        layout: layoutWith(
          { panel: "first", source: "hn" },
          { panel: "second", source: "blog" },
          { panel: "everything", source: "all" },
          { panel: "firehose", source: "all" },
        ),
      },
      DEFAULT_LAYOUT,
    );

    expect(warningsContaining(warnSpy, "multiple panels share source")).toHaveLength(0);
  });
});

describe("display:counter source-mismatch warning", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  const counterAdapter = {
    type: "counter",
    name: "steps",
    params: { url: "https://example.test/steps.json", json_path: "count" },
  };

  test("warns when display:counter has no counter source", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        layout: layoutWith({ panel: "stats", source: "hn", display: "counter" }),
      },
      DEFAULT_LAYOUT,
    );

    const warnings = warningsContaining(warnSpy, "display: counter");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('panel "stats"');
    expect(warnings[0]).toContain("No data yet");
  });

  test("no warning when a source is a counter adapter", () => {
    validateParsedConfig(
      {
        adapters: [counterAdapter],
        layout: layoutWith({ panel: "stats", source: "steps", display: "counter" }),
      },
      DEFAULT_LAYOUT,
    );

    expect(warningsContaining(warnSpy, "display: counter")).toHaveLength(0);
  });

  test("no warning when a pipeline upstream is a counter adapter", () => {
    validateParsedConfig(
      {
        adapters: [counterAdapter],
        pipelines: [{ name: "smoothed", sources: ["steps"], transforms: [] }],
        layout: layoutWith({ panel: "stats", source: "smoothed", display: "counter" }),
      },
      DEFAULT_LAYOUT,
    );

    expect(warningsContaining(warnSpy, "display: counter")).toHaveLength(0);
  });

  test("source all is exempt", () => {
    validateParsedConfig(
      {
        adapters: [{ type: "hackernews", name: "hn" }],
        layout: layoutWith({ panel: "stats", source: "all", display: "counter" }),
      },
      DEFAULT_LAYOUT,
    );

    expect(warningsContaining(warnSpy, "display: counter")).toHaveLength(0);
  });
});
