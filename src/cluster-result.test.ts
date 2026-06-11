import { describe, test, expect } from "bun:test";
import { makeContentItemRow } from "./test/content-items";
import { buildAnnotatedClusterResult } from "./cluster-result";
import type { ClusterGroup } from "./cluster-graph";
import type { ClusterItemSignals } from "./cluster-signals";

function signal(overrides: Partial<ClusterItemSignals> = {}): ClusterItemSignals {
  return {
    domain: "",
    keywords: new Set(),
    source: "",
    ...overrides,
  };
}

describe("cluster-result", () => {
  test("annotates cluster bodies with generated label and sorts by engagement", () => {
    const items = [
      makeContentItemRow({
        id: "low",
        body: "5 points",
        url: "https://github.com/a",
        title: "Release alpha",
        source: "github-releases",
      }),
      makeContentItemRow({
        id: "high",
        body: "200 points",
        url: "https://github.com/b",
        title: "Release beta",
        source: "github-releases",
      }),
    ];
    const signals = [
      signal({ domain: "github.com", source: "github-releases" }),
      signal({ domain: "github.com", source: "github-releases" }),
    ];
    const clusters: ClusterGroup[] = [{ indices: [0, 1], label: "" }];

    const result = buildAnnotatedClusterResult(items, signals, clusters, [], true);

    expect(clusters[0].label).toBe("GitHub");
    expect(result.map((row) => row.id)).toEqual(["high", "low"]);
    expect(result[0].body).toBe("[GitHub] 200 points");
    expect(result[1].body).toBe("[GitHub] 5 points");
  });

  test("appends unclustered items sorted by timestamp descending", () => {
    const items = [
      makeContentItemRow({
        id: "older",
        timestamp: "2024-01-01T00:00:00.000Z",
        body: "older body",
      }),
      makeContentItemRow({
        id: "newer",
        timestamp: "2024-06-01T00:00:00.000Z",
        body: "newer body",
      }),
    ];
    const signals = [signal(), signal()];

    const result = buildAnnotatedClusterResult(items, signals, [], [0, 1], true);

    expect(result.map((row) => row.id)).toEqual(["newer", "older"]);
    expect(result[0].body).toBe("newer body");
    expect(result[1].body).toBe("older body");
  });

  test("leaves bodies unchanged when annotate is false", () => {
    const items = [
      makeContentItemRow({
        id: "a",
        body: "plain body",
        url: "https://github.com/a",
        source: "github-releases",
      }),
      makeContentItemRow({
        id: "b",
        body: "other body",
        url: "https://github.com/b",
        source: "github-releases",
      }),
    ];
    const signals = [
      signal({ domain: "github.com", source: "github-releases" }),
      signal({ domain: "github.com", source: "github-releases" }),
    ];
    const clusters: ClusterGroup[] = [{ indices: [0, 1], label: "" }];

    const result = buildAnnotatedClusterResult(items, signals, clusters, [], false);

    expect(result.map((row) => row.body)).toEqual(["plain body", "other body"]);
  });
});