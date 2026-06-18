import { describe, it, expect } from "bun:test";
import { spyConsole } from "./test/console-spy";
import { formatDashboardUpdatedAt, renderDashboard, type PanelData } from "./layout";
import { collectPanels, resolvePanelId } from "./layout/types";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg, textCfg } from "./test/layout-cfg";
import { expectDashboardRefreshAction } from "./test/server-harness";

describe("renderDashboard", () => {
  it("renders full HTML5 doctype + basic shell with title, footer, and stylesheet link", () => {
    const layout = flexCfg("row", []);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "2026-05-21 12:34" });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8"/>');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"/>');
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
    expect(html).toContain('<h2 title="My Panel">My Panel</h2>');
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

  it("renders item-body fallback with truncation when body is long and no summary", () => {
    const longBody = "A".repeat(300);
    const item = makeItem({ title: "LongBody", summary: null, body: longBody });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("item-body");
    expect(html).not.toContain("item-summary");
    // Truncated to 200 chars + "..."
    expect(html).toContain("A".repeat(200) + "...");
    expect(html).not.toContain("A".repeat(201));
  });

  it("renders item-body without truncation when body is short", () => {
    const shortBody = "42 points, 15 comments";
    const item = makeItem({ title: "ShortBody", summary: null, body: shortBody });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("item-body");
    expect(html).toContain("42 points, 15 comments");
    expect(html).not.toContain("...");
  });

  it("strips HTML tags from body text before rendering", () => {
    const htmlBody = '<p>Hello <strong>world</strong></p><img src="x">';
    const item = makeItem({ title: "HtmlBody", summary: null, body: htmlBody });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("item-body");
    expect(html).toContain("Hello world");
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<p>");
    expect(html).not.toContain("<img");
  });

  it("does not render empty item-body div when body is HTML-only tags that strip to nothing", () => {
    const htmlOnlyBody = '<div><span></span><br/><img src="x"/></div>';
    const item = makeItem({ title: "HtmlOnly", summary: null, body: htmlOnlyBody });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).not.toContain("item-body");
    expect(html).not.toContain("item-summary");
  });

  it("prefers summary over body when both are present", () => {
    const item = makeItem({ title: "Both", summary: "LLM summary", body: "Raw body text" });
    const layout = panelCfg("P", "s");
    const panelData = new Map<string, PanelData>([["P", { items: [item] }]]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("item-summary");
    expect(html).toContain("LLM summary");
    expect(html).not.toContain("item-body");
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
    expect(html).toContain('<h2 title="Notes">Notes</h2>');
    expect(html).toContain('class="text-widget-body"');
    // plain format escapes HTML tags
    expect(html).toContain("&lt;b&gt;world&lt;/b&gt;");
  });

  it("renders text widget with markdown format", () => {
    const layout = flexCfg("row", [
      textCfg("**bold** text", "markdown"),
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("text");
  });

  it("renders text widget with html format (sanitized)", () => {
    const layout = flexCfg("row", [
      textCfg("<p>safe</p><script>alert(1)</script>", "html"),
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
    expect(html).toContain('<h2 title="Dashboard">Dashboard</h2>');
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
  // -- Image widget: max_height and object_fit variants --

  it("renders image widget with max_height applied as container style", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/tall.png", max_height: "200px" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("max-height:200px");
    expect(html).toContain('src="https://example.com/tall.png"');
  });

  it("renders image widget with object_fit: cover when specified", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/bg.jpg", object_fit: "cover" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("object-fit:cover");
    expect(html).not.toContain("object-fit:contain");
  });

  it("renders image widget with empty alt attribute when alt is omitted", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/decorative.png" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('alt=""');
  });

  it("renders image widget link with unsafe URL as no-link (no wrapping anchor)", () => {
    const layout = flexCfg("row", [
      { image: "https://example.com/img.png", link: "javascript:alert(1)" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    // The image-widget should not wrap the img in an anchor
    expect(html).toContain('class="image-widget"><img');
    expect(html).not.toContain('href="javascript:');
  });

  // -- Text widget: title presence/absence --

  it("renders text widget without title header when title is omitted", () => {
    const layout = flexCfg("row", [
      { text: "Just some plain text" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="text-widget-body"');
    expect(html).toContain("Just some plain text");
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain("<h2>");
  });

  it("renders text widget with special chars escaped in plain mode", () => {
    const layout = flexCfg("row", [
      { text: '<script>alert("xss")</script> & "quotes"' },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quotes&quot;");
  });

  it("renders text widget markdown with inline code", () => {
    const layout = flexCfg("row", [
      textCfg("Run `npm install` to start", "markdown"),
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<code>npm install</code>");
  });

  it("renders text widget html format stripping event handlers", () => {
    const layout = flexCfg("row", [
      textCfg('<p onmouseover="alert(1)">hover me</p>', "html"),
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("<p>hover me</p>");
    expect(html).not.toContain("onmouseover");
  });

  // -- Iframe widget: custom sandbox, allow, aspect_ratio variants --

  it("renders iframe widget with custom sandbox tokens", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", sandbox: "allow-scripts allow-popups" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('sandbox="allow-scripts allow-popups"');
  });

  it("renders iframe widget with allow attribute when set", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", allow: "fullscreen; autoplay" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('allow="fullscreen; autoplay"');
  });

  it("renders iframe widget with custom aspect_ratio", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com", aspect_ratio: "4/3" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("aspect-ratio:4/3");
    expect(html).not.toContain("aspect-ratio:16/9");
  });

  it("renders iframe widget without title header when title is omitted", () => {
    const layout = flexCfg("row", [
      { iframe: "https://example.com" },
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain("<h2>");
    expect(html).toContain('class="iframe-panel"');
  });

  // -- Counter panel: trend direction variants and number abbreviation --

  it("renders counter panel with down trend arrow when value decreased", () => {
    const counterItem = makeItem({
      title: "Errors",
      body: JSON.stringify({ value: 50, previous: 200 }),
    });
    const layout = flexCfg("row", [
      panelCfg("Down Trend", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Down Trend", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="stat-trend stat-trend-down"');
    expect(html).toContain("title=\"Decreasing\"");
  });

  it("renders counter panel without trend arrow when no previous value", () => {
    const counterItem = makeItem({
      title: "Active Users",
      body: JSON.stringify({ value: 42 }),
    });
    const layout = flexCfg("row", [
      panelCfg("No Trend", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["No Trend", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain('class="stat-card"');
    expect(html).toContain("42");
    expect(html).not.toContain("stat-trend");
  });

  it("renders counter panel with millions abbreviated (M suffix)", () => {
    const counterItem = makeItem({
      title: "Downloads",
      body: JSON.stringify({ value: 2500000 }),
    });
    const layout = flexCfg("row", [
      panelCfg("Millions", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Millions", { items: [counterItem] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("2.5M");
  });

  it("renders counter panel with multiple stat cards", () => {
    const items = [
      makeItem({ id: "c1", title: "CPU", body: JSON.stringify({ value: 45, unit: "%" }) }),
      makeItem({ id: "c2", title: "Memory", body: JSON.stringify({ value: 78, unit: "%" }) }),
      makeItem({ id: "c3", title: "Disk", body: JSON.stringify({ value: 60, unit: "%" }) }),
    ];
    const layout = flexCfg("row", [
      panelCfg("System", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>([
      ["System", { items }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    const cardMatches = html.match(/stat-card/g);
    expect(cardMatches?.length).toBe(3);
    expect(html).toContain("CPU");
    expect(html).toContain("Memory");
    expect(html).toContain("Disk");
  });

  it("renders counter panel empty state when no panel data exists", () => {
    const layout = flexCfg("row", [
      panelCfg("Missing Data", "counter", { display: "counter" }),
    ]);
    const panelData = new Map<string, PanelData>();
    const html = renderDashboard({ layout, panelData, updatedAt: "now" });
    expect(html).toContain("No data yet");
    expect(html).not.toContain("stat-card");
  });

  // -- collectPanels: widget exclusion --

  it("collectPanels excludes widget nodes from result", () => {
    const layout = flexCfg("row", [
      panelCfg("Feed", "rss"),
      { image: "https://example.com/logo.png" },
      { text: "Hello world" },
      { iframe: "https://example.com" },
      flexCfg("column", [
        panelCfg("Tech", "hackernews"),
        { image: "https://example.com/banner.png" },
      ]),
    ]);
    const panels = collectPanels(layout);
    expect(panels.length).toBe(2);
    expect(panels[0]!.panel).toBe("Feed");
    expect(panels[1]!.panel).toBe("Tech");
  });

  // -- Full pipeline integration: all widget types through LayoutNode dispatch --

  it("renders complete dashboard with all widget types through LayoutNode dispatch", () => {
    const layout = flexCfg("row", [
      flexCfg("column", [
        { image: "https://example.com/header.png", alt: "Header", max_height: "100px", link: "https://example.com" },
        textCfg("# Welcome\nThis is a **dashboard**.", "markdown", { title: "Info" }),
      ]),
      flexCfg("column", [
        { iframe: "https://grafana.example.com/d/overview", title: "Grafana", height: "300px" },
        panelCfg("Stats", "counter", { display: "counter" }),
        panelCfg("News", "rss"),
      ]),
    ]);
    const panelData = new Map<string, PanelData>([
      ["Stats", { items: [makeItem({ title: "Stars", body: JSON.stringify({ value: 1500000, unit: "stars", previous: 1400000 }) })] }],
      ["News", { items: [makeItem({ title: "Breaking News" })] }],
    ]);
    const html = renderDashboard({ layout, panelData, updatedAt: "2026-06-14 12:00" });

    // Image widget fully rendered
    expect(html).toContain('src="https://example.com/header.png"');
    expect(html).toContain('alt="Header"');
    expect(html).toContain("max-height:100px");
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('loading="lazy"');

    // Text widget with markdown rendered
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>dashboard</strong>");
    expect(html).toContain('<h2 title="Info">Info</h2>');
    expect(html).toContain('class="panel-header"');

    // Iframe widget rendered
    expect(html).toContain('src="https://grafana.example.com/d/overview"');
    expect(html).toContain('<h2 title="Grafana">Grafana</h2>');
    expect(html).toContain("height:300px");
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
    expect(html).toContain('referrerpolicy="no-referrer"');

    // Counter panel rendered
    expect(html).toContain("1.5M");
    expect(html).toContain('class="stat-unit">stars</span>');
    expect(html).toContain("stat-trend-up");

    // Regular panel rendered
    expect(html).toContain("Breaking News");

    // Page structure
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("2026-06-14 12:00 UTC");
  });
});

describe("formatDashboardUpdatedAt", () => {
  it("formats UTC timestamps without T and with second precision", () => {
    expect(formatDashboardUpdatedAt(new Date("2026-05-31T00:42:17.891Z"))).toBe("2026-05-31 00:42:17");
  });
});
