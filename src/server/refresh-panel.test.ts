import { describe, test, expect } from "bun:test";
import {
  resolveRefreshPanelBinding,
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
});