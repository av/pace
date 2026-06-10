import { describe, it, expect } from "bun:test";
import { spyConsole } from "./test/console-spy";
import { formatDashboardUpdatedAt, renderDashboard, type PanelData } from "./layout";
import { resolvePanelId } from "./config";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { expectDashboardRefreshAction } from "./test/server-harness";

describe("renderDashboard", () => {
  it("renders full HTML5 doctype + basic shell with title, footer, and stylesheet link", () => {
    const layout = flexCfg("row", []);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "2026-05-21 12:34" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain("<title>pace</title>");
    expect(html).toContain('<footer class="footer"><a href="https://github.com/av/pace" target="_blank" rel="noopener noreferrer">Pace</a> / 2026-05-21 12:34 UTC</footer>');
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"/>');
    expect(html).toContain('<div class="flex-root">');
  });

  it("renders a simple panel node with one item (safe https link, source, just-now time)", () => {
    const now = Date.now();
    const item = makeItem({
      title: "Hello Item",
      url: "https://safe.com/path",
      source: "mysrc",
      timestamp: new Date(now - 10000).toISOString(), // ~10s ago -> just now
    });
    const layout = panelCfg("My Panel", "mysrc");
    const panelData = new Map<string, PanelData>([["My Panel", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<h2>My Panel</h2>");
    expect(html).toContain(">Hello Item</a>");
    expect(html).toContain('href="https://safe.com/path"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("just now");
    expect(html).toContain('<span class="item-source">mysrc</span>');
    expect(html).toContain('<form method="POST"');
    expectDashboardRefreshAction(html, resolvePanelId(panelCfg("My Panel", "mysrc")));
  });

  it("renders item without safe url as plain span (no anchor) for ftp:// and invalid", () => {
    const itemBad = makeItem({ title: "Bad Link", url: "ftp://bad.com" });
    const itemInvalid = makeItem({ title: "No Link", url: "not-a-url" });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [itemBad, itemInvalid] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).not.toContain('href="ftp://bad.com"');
    expect(html).toContain("<span>Bad Link</span>");
    expect(html).toContain("<span>No Link</span>");
  });

  it("warns on safeLinkUrl parse failure; disallowed protocols stay silent", async () => {
    await spyConsole(["warn"], ({ warn: warnSpy }) => {
      const invalid = makeItem({ title: "No Link", url: "not-a-url" });
      const ftp = makeItem({ title: "Bad Link", url: "ftp://bad.com" });
      const layout = panelCfg("P", "s");
      const panelData = new Map<string, PanelData>([["P", { items: [invalid, ftp] }]]);
      renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^layout: safeUrl failed for "not-a-url": /),
      );
    });
  });

  it("renders mailto: links as safe anchors", () => {
    const item = makeItem({ title: "Contact", url: "mailto:me@example.com" });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('href="mailto:me@example.com"');
    expect(html).toContain(">Contact</a>");
  });

  it("renders item summary when present, omits when null/empty", () => {
    const withSum = makeItem({ title: "S", summary: "This is the summary text." });
    const without = makeItem({ title: "NoS", summary: null });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [withSum, without] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('<div class="item-summary">This is the summary text.</div>');
    expect(html).toContain(">S</a>");
    // second item has no summary (verified by only one .item-summary in output)
  });

  it("shows empty state when panel has no items", () => {
    const layout = panelCfg("EmptyP", "s");
    const panelData = new Map<string, PanelData>([["EmptyP", { items: [] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('<div class="empty-state">No content yet</div>');
  });

  it("renders lastRefreshedAt using relativeTime in panel header", () => {
    const now = Date.now();
    const refreshed = new Date(now - 3 * 60000).toISOString(); // 3m ago
    const item = makeItem();
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item], lastRefreshedAt: refreshed }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("3m ago");
    expect(html).toContain('class="panel-refreshed"');
  });

  it("renders flex container (row) with multiple child panels recursively", () => {
    const p1 = panelCfg("A", "s");
    const p2 = panelCfg("B", "s");
    const layout = flexCfg("row", [p1, p2]);
    const panelData = new Map<string, PanelData>([
      ["A", { items: [makeItem({ title: "ItemA" })] }],
      ["B", { items: [makeItem({ title: "ItemB" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="flex-container"');
    expect(html).toContain('style="display:flex; flex-direction:row;');
    expect(html).toContain("ItemA");
    expect(html).toContain("ItemB");
    expect(html).toContain('flex-panel" style="flex:1;'); // default flex
  });

  it("renders flex container (column) and respects explicit flex values in styles", () => {
    const child = panelCfg("C", "s", { flex: 2 });
    const layout = flexCfg("column", [child], { gap: "2rem", flex: 3 });
    const panelData = new Map<string, PanelData>([["C", { items: [] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('flex-direction:column');
    expect(html).toContain('gap:2rem');
    expect(html).toContain('flex:3');
    expect(html).toContain('flex:2'); // child explicit
  });

  it("uses explicit panel id in refresh form action (not hashed)", () => {
    const layout = panelCfg("Named", "s", { id: "my-explicit-id" });
    const panelData = new Map<string, PanelData>([["Named", { items: [] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expectDashboardRefreshAction(html, "my-explicit-id");
    expect(html).not.toContain('action="/refresh/' + resolvePanelId(panelCfg("Named", "s"))); // would be hash if no id
  });

  it("prefers panelId from loaded panel data over layout-derived id", () => {
    const layout = panelCfg("Named", "s", { id: "layout-id" });
    const panelData = new Map<string, PanelData>([["Named", {
      panelId: "runtime-id",
      items: [],
      lastRefreshedAt: null,
    }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expectDashboardRefreshAction(html, "runtime-id");
    expect(html).not.toContain('action="/refresh/layout-id"');
  });

  it("renders relativeTime edge buckets (m/h/d) and NaN timestamp as empty", () => {
    const now = Date.now();
    const m59 = new Date(now - 59 * 60000).toISOString();
    const h5 = new Date(now - 5 * 3600000).toISOString();
    const d2 = new Date(now - 2 * 86400000).toISOString();
    const bad = makeItem({ timestamp: "not-a-date", title: "BadTime" });
    const layout = panelCfg("T", "s");
    const panelData = new Map<string, PanelData>([["T", {
      items: [
        makeItem({ timestamp: m59, title: "M" }),
        makeItem({ timestamp: h5, title: "H" }),
        makeItem({ timestamp: d2, title: "D" }),
        bad,
      ],
    }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("59m ago");
    expect(html).toContain("5h ago");
    expect(html).toContain("2d ago");
    // bad time renders empty time span (no digits from relative)
    expect(html).toContain(">BadTime</a>");
    expect(html).toContain('<span class="item-time"></span>');
  });

  it("renders compact footer with Pace hyperlink to github, updatedAt UTC, document title 'pace', and omits deprecated header/updated span per layout facts (gp9,r3s,swp,c00)", () => {
    const layout = flexCfg("row", []);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "2026-05-31 00:42" });
    expect(html).toContain("<title>pace</title>");
    expect(html).toContain('<footer class="footer">');
    expect(html).toContain('<a href="https://github.com/av/pace" target="_blank" rel="noopener noreferrer">Pace</a> / 2026-05-31 00:42 UTC');
    expect(html).not.toContain('<span class="updated">');
    expect(html).not.toContain('class="header"');
    expect(html).not.toContain("<h1>pace</h1>"); // old header branding removed
    expect(html).toContain('<link rel="stylesheet" href="/styles.css"/>');
  });
});

describe("formatDashboardUpdatedAt", () => {
  it("formats UTC timestamps without T and with second precision", () => {
    expect(formatDashboardUpdatedAt(new Date("2026-05-31T00:42:17.891Z"))).toBe("2026-05-31 00:42:17");
  });
});
