import { describe, it, expect } from "bun:test";
import { spyConsole } from "./test/console-spy";
import { formatDashboardUpdatedAt, renderDashboard, type PanelData } from "./layout";
import { resolvePanelId } from "./layout/types";
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
    expect(html).not.toContain("item-summary-label");
    expect(html).toContain('<form method="POST"');
    expectDashboardRefreshAction(html, resolvePanelId(panelCfg("My Panel", "mysrc")));
  });

  it("renders merged origins as individual source pills with count badge", () => {
    const merged = makeItem({ id: "m1", title: "Merged", origins: JSON.stringify(["hn", "lobsters"]) });
    const single = makeItem({ id: "s1", title: "Single", origins: JSON.stringify(["hn"]) });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [merged, single] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('<span class="item-source src-hn">hn</span>');
    expect(html).toContain('<span class="item-source src-lobsters">lobsters</span>');
    expect(html).toContain('<span class="item-merged">2 sources</span>');
    expect(html.match(/item-merged/g)?.length).toBe(1);
  });

  it("renders without item-origins and without throwing on malformed or non-array origins", () => {
    const malformed = makeItem({ id: "b1", title: "Bad JSON", origins: "not-json{" });
    const nonArray = makeItem({ id: "b2", title: "Non Array", origins: "{}" });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [malformed, nonArray] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).not.toContain("item-origins");
    expect(html).toContain("Bad JSON");
    expect(html).toContain("Non Array");
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
    expect(html).toContain("item-summary");
    expect(html).toContain('<span class="item-summary-label">summarized</span>');
    expect(html).toContain("This is the summary text.");
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

  it("renders image widget with flex-panel wrapper, image tag, and lazy loading", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/logo.png", alt: "Logo", flex: 2 },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="flex-panel"');
    expect(html).toContain('class="image-widget"');
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('alt="Logo"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("flex:2;");
    expect(html).toContain("object-fit:contain");
  });

  it("renders image widget with safe link wrapping when link is set", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.jpg", link: "https://example.com" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain("rel=\"noopener noreferrer\"");
  });

  it("renders image widget without link when link is omitted", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.jpg" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    // The image should not be wrapped in a link (footer has its own <a>)
    expect(html).toContain('src="https://example.com/img.jpg"');
    expect(html).not.toContain('href="https://example.com/img.jpg"');
    expect(html).toContain('<div class="image-widget"><img');
  });

  it("renders text widget with plain text (no HTML injection)", () => {
    const layout = flexCfg("row", [
      { text: "Hello <b>world</b>", title: "Notes" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="panel text-widget"');
    expect(html).toContain("<h2>Notes</h2>");
    expect(html).toContain('class="text-widget-body"');
    // plain format escapes HTML tags
    expect(html).toContain("&lt;b&gt;world&lt;/b&gt;");
  });

  it("renders text widget with markdown format", () => {
    const layout = flexCfg("row", [
      { text: "**bold** text", format: "markdown" as const },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("text");
  });

  it("renders text widget with html format (sanitized)", () => {
    const layout = flexCfg("row", [
      { text: "<p>safe</p><script>alert(1)</script>", format: "html" as const },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<p>safe</p>");
    expect(html).not.toContain("<script>");
  });

  it("renders iframe widget with sandbox and referrerpolicy defaults", () => {
    const layout = flexCfg("row", [
      { iframe: "https://grafana.example.com/d/abc" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="iframe-panel"');
    expect(html).toContain('src="https://grafana.example.com/d/abc"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('referrerpolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
  });

  it("renders iframe widget with title header", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", title: "Dashboard" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<h2>Dashboard</h2>");
    expect(html).toContain('class="panel-header"');
    // iframe widget title header should not have refresh button
    expect(html).not.toContain("refresh-btn");
  });

  it("renders iframe widget with aspect-ratio default 16/9 when no height set", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("aspect-ratio:16/9");
  });

  it("renders iframe widget with explicit height (no aspect-ratio)", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", height: "400px" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("height:400px");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders counter panel with stat cards from panel data", () => {
    const counterItem = makeItem({
      title: "Requests",
      body: JSON.stringify({ value: 12345, unit: "req/s", previous: 10000 }),
    });
    const layout = flexCfg("row", [
      panelCfg("Metrics", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Metrics", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="counter-panel"');
    expect(html).toContain('class="stat-card"');
    expect(html).toContain("12.3k"); // abbreviated
    expect(html).toContain('class="stat-unit">req/s</span>');
    expect(html).toContain('class="stat-trend stat-trend-up"'); // 12345 > 10000
  });

  it("renders counter panel empty state when body is not valid JSON", () => {
    const badItem = makeItem({ title: "Bad", body: "not-json" });
    const layout = flexCfg("row", [
      panelCfg("Bad Counter", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Bad Counter", { items: [badItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="counter-panel"');
    expect(html).toContain("No data yet");
  });

  it("renders mixed layout with panels, widgets, and containers together", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss"),
      flexCfg("column", [
        { image: "https://example.com/banner.png" },
        { text: "Welcome to the dashboard", title: "Info" },
        { iframe: "https://grafana.example.com/d/overview" },
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Feed", { items: [makeItem({ title: "News" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    // All node types rendered
    expect(html).toContain("News");
    expect(html).toContain("image-widget");
    expect(html).toContain("text-widget");
    expect(html).toContain("iframe-panel");
    // Nested flex container present
    const containerMatches = html.match(/flex-container/g);
    expect(containerMatches?.length).toBeGreaterThanOrEqual(2); // root + nested
  });
});

describe("formatDashboardUpdatedAt", () => {
  it("formats UTC timestamps without T and with second precision", () => {
    expect(formatDashboardUpdatedAt(new Date("2026-05-31T00:42:17.891Z"))).toBe("2026-05-31 00:42:17");
  });
});
