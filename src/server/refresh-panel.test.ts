import { describe, test, expect } from "bun:test";
import type { RefreshResult } from "../scheduler";
import {
  resolveRefreshPanelBinding,
  collectRefreshFailures,
  formatRefreshPanelFailureBody,
  formatRefreshSourceFailure,
  formatUnknownRefreshPanelBody,
} from "./refresh-panel";

describe("refresh panel helpers", () => {
  const panelNameToId = new Map([
    ["tech", "tech-panel"],
    ["reddit", "reddit-panel"],
  ]);
  const panelIdToRefreshSourceNames = new Map([
    ["tech-panel", ["hackernews"]],
    ["reddit-panel", ["reddit"]],
    ["empty-panel", []],
  ]);

  test("resolveRefreshPanelBinding resolves panel name to id and source names", () => {
    expect(
      resolveRefreshPanelBinding("tech", panelNameToId, panelIdToRefreshSourceNames),
    ).toEqual({ ok: true, panelId: "tech-panel", sourceNames: ["hackernews"] });
  });

  test("resolveRefreshPanelBinding accepts explicit panel id param", () => {
    expect(
      resolveRefreshPanelBinding("reddit-panel", panelNameToId, panelIdToRefreshSourceNames),
    ).toEqual({ ok: true, panelId: "reddit-panel", sourceNames: ["reddit"] });
  });

  test("resolveRefreshPanelBinding returns unknown for missing panel", () => {
    expect(
      resolveRefreshPanelBinding("missing", panelNameToId, panelIdToRefreshSourceNames),
    ).toEqual({ ok: false, param: "missing" });
  });

  test("formatUnknownRefreshPanelBody echoes route param", () => {
    expect(formatUnknownRefreshPanelBody("missing")).toBe("Unknown panel: missing");
  });

  test("formatRefreshSourceFailure includes error detail when present", () => {
    expect(formatRefreshSourceFailure("reddit", "boom")).toBe("reddit: boom");
    expect(formatRefreshSourceFailure("reddit")).toBe("reddit");
  });

  test("collectRefreshFailures keeps only failed refresh results", () => {
    const results = [
      { kind: "adapter", name: "ok", status: "ok" },
      { kind: "adapter", name: "skip", status: "skipped" },
      { kind: "adapter", name: "bad", status: "failed", error: "boom" },
    ] satisfies RefreshResult[];

    expect(collectRefreshFailures(results)).toEqual([
      { kind: "adapter", name: "bad", status: "failed", error: "boom" },
    ]);
  });

  test("formatRefreshPanelFailureBody joins multiple source failures", () => {
    const failures = [
      { kind: "adapter", name: "reddit", status: "failed", error: "boom" },
      { kind: "pipeline", name: "merge", status: "failed", error: "timeout" },
    ] satisfies RefreshResult[];

    expect(formatRefreshPanelFailureBody(failures)).toBe(
      "Refresh failed for reddit: boom; merge: timeout",
    );
  });
});