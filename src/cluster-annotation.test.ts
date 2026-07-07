import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test";
import { applyCluster } from "./cluster";
import { buildAnnotatedClusterResult } from "./cluster-result";
import { stripClusterAnnotationPrefixes, type ClusterItemSignals } from "./cluster-signals";
import type { ClusterGroup } from "./cluster-graph";
import type { ContentItemRow } from "./db";

function item(overrides: Partial<ContentItemRow> & { id: string }): ContentItemRow {
  return {
    panel_id: "p",
    source: "hn",
    title: "",
    url: "https://example.com/" + overrides.id,
    body: "",
    timestamp: "2026-01-01T00:00:00Z",
    fetched_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ContentItemRow;
}

let logSpy: ReturnType<typeof spyOn>;
beforeEach(() => {
  logSpy = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
});

describe("stripClusterAnnotationPrefixes", () => {
  test("strips a single leading annotation prefix", () => {
    expect(stripClusterAnnotationPrefixes("[Rust/Speed] body text")).toBe("body text");
  });

  test("strips stacked prefixes accumulated by repeated runs", () => {
    expect(stripClusterAnnotationPrefixes("[A] [B] [C] body")).toBe("body");
  });

  test("leaves brackets in the middle of the body alone", () => {
    expect(stripClusterAnnotationPrefixes("body with [note] inside")).toBe(
      "body with [note] inside"
    );
  });

  test("leaves bodies without prefixes and empty brackets untouched", () => {
    expect(stripClusterAnnotationPrefixes("plain body")).toBe("plain body");
    expect(stripClusterAnnotationPrefixes("[] not a label")).toBe("[] not a label");
  });
});

describe("cluster annotation idempotence", () => {
  const cfg = {
    type: "cluster",
    strategy: "keywords",
    similarity_threshold: 0.3,
  } as Parameters<typeof applyCluster>[1];

  const makeItems = () => [
    item({ id: "1", title: "Rust compiler speed improvements", url: "https://a.com/1", body: "rust compiler speed" }),
    item({ id: "2", title: "Rust compiler gets faster", url: "https://b.com/2", body: "rust compiler faster" }),
    item({ id: "3", title: "Cooking pasta recipes", url: "https://c.com/3", body: "pasta" }),
  ];

  test("re-running applyCluster on its own output does not stack annotations", () => {
    const once = applyCluster(makeItems(), cfg);
    const twice = applyCluster(once, cfg);
    expect(twice.map((i) => i.body)).toEqual(once.map((i) => i.body));
    // sanity: exactly one prefix on clustered items
    const clustered = twice.find((i) => i.id === "1")!;
    expect(clustered.body).toMatch(/^\[[^\]]+\] rust compiler speed$/);
  });

  test("stale annotation is removed from items that become unclustered", () => {
    const items = [
      item({ id: "1", body: "[Old/Label] some body", title: "unique alpha thing", url: "https://a.com/1" }),
      item({ id: "2", body: "other body", title: "totally different beta", url: "https://b.com/2" }),
    ];
    const out = applyCluster(items, { ...cfg, similarity_threshold: 0.99 });
    const one = out.find((i) => i.id === "1")!;
    expect(one.body).toBe("some body");
  });

  test("stale label keywords do not leak into clustering signals", () => {
    // Without prefix stripping in buildClusterSignals, the shared stale
    // "[Zebra/Quagga]" prefix would create keyword overlap between
    // otherwise unrelated items.
    const items = [
      item({ id: "1", body: "[Zebra/Quagga] mountain hiking gear", title: "", url: "https://a.com/1" }),
      item({ id: "2", body: "[Zebra/Quagga] quantum computing news", title: "", url: "https://b.com/2" }),
    ];
    const out = applyCluster(items, { ...cfg, similarity_threshold: 0.3 });
    expect(out.map((i) => i.body).sort()).toEqual([
      "mountain hiking gear",
      "quantum computing news",
    ]);
  });
});

describe("fallback cluster labels", () => {
  test("multiple fallback-labeled clusters get distinct numbered labels", () => {
    const items = [0, 1, 2, 3].map((n) => item({ id: String(n), body: "b" + n }));
    const signals: ClusterItemSignals[] = [0, 1, 2, 3].map((n) => ({
      domain: `d${n}.com`,
      keywords: new Set<string>(),
      source: `src-${n}`,
    }));
    const clusters: ClusterGroup[] = [
      { indices: [0, 1], label: "" },
      { indices: [2, 3], label: "" },
    ];
    const out = buildAnnotatedClusterResult(items, signals, clusters, [], true);
    expect(clusters[0].label).toBe("Cluster 1");
    expect(clusters[1].label).toBe("Cluster 2");
    expect(out.map((i) => i.body)).toEqual([
      "[Cluster 1] b0",
      "[Cluster 1] b1",
      "[Cluster 2] b2",
      "[Cluster 2] b3",
    ]);
  });
});
