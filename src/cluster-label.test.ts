import { describe, test, expect } from "bun:test";
import { generateClusterLabel } from "./cluster-label";
import type { ClusterItemSignals } from "./cluster-signals";

function signal(overrides: Partial<ClusterItemSignals> = {}): ClusterItemSignals {
  return {
    domain: "",
    keywords: new Set(),
    source: "",
    ...overrides,
  };
}

describe("cluster-label", () => {
  test("returns mapped domain label when >=60% share the same domain", () => {
    const signals = [
      signal({ domain: "github.com" }),
      signal({ domain: "github.com" }),
      signal({ domain: "medium.com" }),
    ];

    expect(generateClusterLabel([0, 1, 2], signals, 1)).toBe("GitHub");
  });

  test("uses top keyword label when no domain reaches majority threshold", () => {
    const signals = [
      signal({ domain: "github.com", keywords: new Set(["react", "server"]) }),
      signal({ domain: "medium.com", keywords: new Set(["react", "hooks"]) }),
    ];

    expect(generateClusterLabel([0, 1], signals, 0)).toBe("React/Server/Hooks");
  });

  test("falls back to source majority when domain and keywords do not qualify", () => {
    const signals = [
      signal({ domain: "a.com", keywords: new Set(), source: "twitter" }),
      signal({ domain: "b.com", keywords: new Set(), source: "twitter" }),
    ];

    expect(generateClusterLabel([0, 1], signals, 2)).toBe("twitter");
  });

  test("returns numbered cluster label when no signal family qualifies", () => {
    const signals = [
      signal({ domain: "a.com", keywords: new Set(), source: "src-a" }),
      signal({ domain: "b.com", keywords: new Set(), source: "src-b" }),
    ];

    expect(generateClusterLabel([0, 1], signals, 4)).toBe("Cluster 5");
  });
});