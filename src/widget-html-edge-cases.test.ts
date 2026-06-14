import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "./layout";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";
import { sanitize, renderMarkdown } from "./layout/text-render";
import { abbreviateNumber, parseCounterBody } from "./layout/counter-panel";
import { sanitizeSandboxTokens } from "./config-validate";

// ---------------------------------------------------------------------------
// Helper: render a single widget node and return the HTML string
// ---------------------------------------------------------------------------
function renderWidget(node: Parameters<typeof flexCfg>[1][0], panelData?: Map<string, PanelData>): string {
  const layout = flexCfg("row", [node]);
  return renderDashboard({ layout, panelData: panelData ?? new Map(), updatedAt: "now" });
}

// ===========================================================================
// IMAGE WIDGET EDGE CASES
// ===========================================================================
describe("ImageWidget HTML edge cases", () => {
  it("preserves very long alt text (500+ chars) without truncation", () => {
    const longAlt = "A".repeat(600);
    const html = renderWidget({ image: "https://example.com/img.png", alt: longAlt });
    expect(html).toContain(`alt="${longAlt}"`);
    expect(longAlt.length).toBe(600);
  });

  it("handles URL with query params, fragments, and encoded chars", () => {
    const url = "https://cdn.example.com/img.png?width=800&height=600&fmt=webp#section";
    const html = renderWidget({ image: url });
    // HTML attribute encoding converts & to &amp;
    expect(html).toContain('src="https://cdn.example.com/img.png?width=800&amp;height=600&amp;fmt=webp#section"');
  });

  it("handles URL with unicode path segments", () => {
    const url = "https://example.com/%E4%B8%AD%E6%96%87/photo.jpg";
    const html = renderWidget({ image: url });
    expect(html).toContain(`src="${url}"`);
  });

  it("renders object_fit: cover correctly", () => {
    const html = renderWidget({ image: "https://example.com/bg.jpg", object_fit: "cover" });
    expect(html).toContain("object-fit:cover");
  });

  it("renders object_fit: fill correctly", () => {
    const html = renderWidget({ image: "https://example.com/bg.jpg", object_fit: "fill" });
    expect(html).toContain("object-fit:fill");
  });

  it("renders object_fit: none correctly", () => {
    const html = renderWidget({ image: "https://example.com/bg.jpg", object_fit: "none" });
    expect(html).toContain("object-fit:none");
  });

  it("renders object_fit: contain (default) when omitted", () => {
    const html = renderWidget({ image: "https://example.com/bg.jpg" });
    expect(html).toContain("object-fit:contain");
  });

  it("renders max_height with px unit", () => {
    const html = renderWidget({ image: "https://example.com/img.png", max_height: "200px" });
    expect(html).toContain("max-height:200px");
  });

  it("renders max_height with rem unit", () => {
    const html = renderWidget({ image: "https://example.com/img.png", max_height: "15rem" });
    expect(html).toContain("max-height:15rem");
  });

  it("renders max_height with vh unit", () => {
    const html = renderWidget({ image: "https://example.com/img.png", max_height: "50vh" });
    expect(html).toContain("max-height:50vh");
  });

  it("does not set max-height on the container div when max_height is not specified", () => {
    const html = renderWidget({ image: "https://example.com/img.png" });
    // The container flex-panel should have only flex style, no max-height
    // Note: max-height:100% still appears in the img inline style, which is expected
    expect(html).toContain('<div class="flex-panel" style="flex:1;"');
  });

  it("renders without link wrapper when link is omitted", () => {
    const html = renderWidget({ image: "https://example.com/img.png" });
    // Should have image-widget directly containing img, not an anchor
    expect(html).toContain('<div class="image-widget"><img');
    // Count anchor tags; only footer link should exist
    const anchors = html.match(/<a /g) ?? [];
    const footerAnchors = html.match(/github\.com\/av\/pace/g) ?? [];
    expect(anchors.length).toBe(footerAnchors.length);
  });

  it("renders with empty alt attribute when alt is omitted", () => {
    const html = renderWidget({ image: "https://example.com/decorative.png" });
    expect(html).toContain('alt=""');
  });

  it("renders with default flex and no container max-height when all optional fields omitted", () => {
    const html = renderWidget({ image: "https://example.com/img.png" });
    expect(html).toContain("flex:1;");
    // Container div should not have max-height (img tag has its own max-height:100%)
    expect(html).toContain('<div class="flex-panel" style="flex:1;"');
    expect(html).toContain('alt=""');
    expect(html).toContain("object-fit:contain");
    expect(html).toContain('loading="lazy"');
  });

  it("renders image in a column container with correct flex structure", () => {
    const layout = flexCfg("column", [
      { image: "https://example.com/banner.png", flex: 2 },
      { image: "https://example.com/footer.png", flex: 1 },
    ]);
    const html = renderDashboard({ layout, panelData: new Map(), updatedAt: "now" });
    expect(html).toContain("flex-direction:column");
    expect(html).toContain("flex:2;");
    expect(html).toContain("flex:1;");
    const imageWidgets = html.match(/class="image-widget"/g) ?? [];
    expect(imageWidgets.length).toBe(2);
  });

  it("renders aria-label on linked image with empty alt", () => {
    const html = renderWidget({
      image: "https://example.com/icon.png",
      link: "https://example.com/destination",
    });
    expect(html).toContain('aria-label="https://example.com/destination"');
  });

  it("does NOT render aria-label on linked image with non-empty alt", () => {
    const html = renderWidget({
      image: "https://example.com/icon.png",
      alt: "Company Logo",
      link: "https://example.com/destination",
    });
    expect(html).not.toContain('aria-label=');
  });
});

// ===========================================================================
// TEXT WIDGET EDGE CASES
// ===========================================================================
describe("TextWidget HTML edge cases", () => {
  it("renders empty string text content without error", () => {
    const html = renderWidget({ text: "" });
    expect(html).toContain('class="text-widget-body"');
    // Empty body should still have the container
    expect(html).toContain("text-widget");
  });

  it("renders very long plain text (10k+ chars) without truncation", () => {
    const longText = "x".repeat(10001);
    const html = renderWidget({ text: longText });
    expect(html).toContain(longText);
  });

  it("renders markdown h1 through h6", () => {
    const md = ["# H1", "## H2", "### H3", "#### H4", "##### H5", "###### H6"].join("\n\n");
    const html = renderWidget({ text: md, format: "markdown" as const });
    for (let i = 1; i <= 6; i++) {
      expect(html).toContain(`<h${i}`);
      expect(html).toContain(`H${i}`);
    }
  });

  it("renders markdown unordered lists", () => {
    const md = "- alpha\n- beta\n- gamma";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>alpha</li>");
    expect(html).toContain("<li>gamma</li>");
  });

  it("renders markdown ordered lists", () => {
    const md = "1. first\n2. second\n3. third";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain("<ol>");
    expect(html).toContain("<li>first</li>");
  });

  it("renders markdown code blocks with pre and code tags", () => {
    const md = "```js\nconst x = 42;\n```";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain("<pre>");
    expect(html).toContain("<code");
    expect(html).toContain("const x = 42;");
  });

  it("renders markdown links", () => {
    const md = "[Visit](https://example.com)";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain("Visit</a>");
  });

  it("renders markdown images (img tag with src and alt)", () => {
    const md = "![photo](https://example.com/img.jpg)";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain('<img src="https://example.com/img.jpg"');
    expect(html).toContain('alt="photo"');
  });

  it("renders markdown blockquotes", () => {
    const md = "> This is a quote";
    const html = renderWidget({ text: md, format: "markdown" as const });
    expect(html).toContain("<blockquote>");
    expect(html).toContain("This is a quote");
  });

  it("renders markdown details/summary (via HTML pass-through)", () => {
    // Details is an allowed tag in sanitize-html, test via html format
    const content = "<details><summary>Show more</summary><p>Hidden content</p></details>";
    const html = renderWidget({ text: content, format: "html" as const });
    expect(html).toContain("<details>");
    expect(html).toContain("<summary>Show more</summary>");
    expect(html).toContain("<p>Hidden content</p>");
  });

  it("renders HTML with deeply nested allowed tags preserved", () => {
    const deep = "<ul><li><strong><em><code>nested</code></em></strong></li></ul>";
    const html = renderWidget({ text: deep, format: "html" as const });
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>");
    expect(html).toContain("<strong>");
    expect(html).toContain("<em>");
    expect(html).toContain("<code>nested</code>");
  });

  it("renders markdown content in html format mode as raw HTML (not rendered as markdown)", () => {
    // If format is "html", markdown-like content should be treated as HTML (sanitized but not parsed)
    const mdAsHtml = "**bold** and *italic*";
    const html = renderWidget({ text: mdAsHtml, format: "html" as const });
    // Should NOT have <strong> or <em> since html format does not invoke renderMarkdown
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("<em>");
    // The asterisks should appear as text (sanitizer strips nothing since these are plain text)
    expect(html).toContain("**bold**");
  });

  it("renders HTML content in plain format mode as escaped text", () => {
    const htmlContent = "<p>paragraph</p>";
    const html = renderWidget({ text: htmlContent });
    // Plain mode should escape the HTML tags
    expect(html).toContain("&lt;p&gt;paragraph&lt;/p&gt;");
    expect(html).not.toContain("<p>paragraph</p>");
  });

  it("includes tabindex=0 on text-widget-body for keyboard accessibility", () => {
    const html = renderWidget({ text: "Accessible text" });
    expect(html).toContain('tabindex="0"');
  });

  it("includes role=region on text-widget-body", () => {
    const html = renderWidget({ text: "Accessible text" });
    expect(html).toContain('role="region"');
  });

  it("uses title as aria-label when title is provided", () => {
    const html = renderWidget({ text: "Content", title: "My Section" });
    expect(html).toContain('aria-label="My Section"');
  });

  it("falls back to 'Text content' as aria-label when title is omitted", () => {
    const html = renderWidget({ text: "Content" });
    expect(html).toContain('aria-label="Text content"');
  });
});

// ===========================================================================
// IFRAME WIDGET EDGE CASES
// ===========================================================================
describe("IframeWidget HTML edge cases", () => {
  it("renders each of the 13 valid sandbox tokens individually", () => {
    const tokens = [
      "allow-downloads",
      "allow-forms",
      "allow-modals",
      "allow-orientation-lock",
      "allow-pointer-lock",
      "allow-popups",
      "allow-popups-to-escape-sandbox",
      "allow-presentation",
      "allow-same-origin",
      "allow-scripts",
      "allow-top-navigation",
      "allow-top-navigation-by-user-activation",
      "allow-top-navigation-to-custom-protocols",
    ];
    expect(tokens.length).toBe(13);

    for (const token of tokens) {
      const result = sanitizeSandboxTokens(token, "test");
      expect(result).toBe(token);
    }
  });

  it("strips invalid sandbox tokens and preserves valid ones", () => {
    const result = sanitizeSandboxTokens("allow-scripts bogus-token allow-forms another-bad", "test");
    expect(result).toBe("allow-scripts allow-forms");
  });

  it("renders custom allow attribute in iframe HTML", () => {
    const html = renderWidget({
      iframe: "https://example.com",
      allow: "camera; microphone; geolocation",
    });
    expect(html).toContain('allow="camera; microphone; geolocation"');
  });

  it("does not render allow attribute when not specified", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    // allow attribute should not appear at all
    expect(html).not.toMatch(/allow="[^"]*"/);
    // But sandbox should still be there
    expect(html).toContain('sandbox="allow-scripts allow-same-origin"');
  });

  it("renders height with px unit", () => {
    const html = renderWidget({ iframe: "https://example.com", height: "400px" });
    expect(html).toContain("height:400px");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders height with rem unit", () => {
    const html = renderWidget({ iframe: "https://example.com", height: "20rem" });
    expect(html).toContain("height:20rem");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders height with em unit", () => {
    const html = renderWidget({ iframe: "https://example.com", height: "15em" });
    expect(html).toContain("height:15em");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders height with vh unit", () => {
    const html = renderWidget({ iframe: "https://example.com", height: "50vh" });
    expect(html).toContain("height:50vh");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders height with % unit", () => {
    const html = renderWidget({ iframe: "https://example.com", height: "100%" });
    expect(html).toContain("height:100%");
    expect(html).not.toContain("aspect-ratio:");
  });

  it("renders aspect_ratio 1/1 (square)", () => {
    const html = renderWidget({ iframe: "https://example.com", aspect_ratio: "1/1" });
    expect(html).toContain("aspect-ratio:1/1");
  });

  it("renders aspect_ratio 21/9 (ultrawide)", () => {
    const html = renderWidget({ iframe: "https://example.com", aspect_ratio: "21/9" });
    expect(html).toContain("aspect-ratio:21/9");
  });

  it("renders aspect_ratio 100/1 (extreme horizontal)", () => {
    const html = renderWidget({ iframe: "https://example.com", aspect_ratio: "100/1" });
    expect(html).toContain("aspect-ratio:100/1");
  });

  it("renders default aspect_ratio 16/9 when neither height nor aspect_ratio set", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    expect(html).toContain("aspect-ratio:16/9");
  });

  it("renders title attribute on iframe element even when title prop is omitted", () => {
    const html = renderWidget({ iframe: "https://grafana.example.com/d/abc" });
    // Should generate a title from hostname
    expect(html).toContain('title="Embedded content from grafana.example.com"');
  });

  it("renders title attribute from explicit title prop", () => {
    const html = renderWidget({ iframe: "https://example.com", title: "My Dashboard" });
    expect(html).toContain('title="My Dashboard"');
  });

  it("does not show panel-header when title is omitted", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    expect(html).not.toContain("panel-header");
    expect(html).not.toContain("<h2>");
  });

  it("renders URL with port number", () => {
    const html = renderWidget({ iframe: "https://grafana.local:3000/d/overview" });
    expect(html).toContain('src="https://grafana.local:3000/d/overview"');
  });

  it("renders URL with path, query params, and fragment", () => {
    const html = renderWidget({
      iframe: "https://example.com:8080/app/dashboard?theme=dark&refresh=5s#panel-1",
    });
    // HTML encodes & as &amp; in attribute values
    expect(html).toContain('src="https://example.com:8080/app/dashboard?theme=dark&amp;refresh=5s#panel-1"');
  });

  it("always includes referrerpolicy=no-referrer", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("always includes loading=lazy", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    expect(html).toContain('loading="lazy"');
  });

  it("height takes priority over aspect_ratio (aspect_ratio ignored)", () => {
    const html = renderWidget({
      iframe: "https://example.com",
      height: "300px",
      aspect_ratio: "4/3",
    });
    expect(html).toContain("height:300px");
    expect(html).not.toContain("aspect-ratio:");
  });
});

// ===========================================================================
// COUNTER PANEL EDGE CASES
// ===========================================================================
describe("CounterPanel HTML edge cases", () => {
  describe("abbreviateNumber boundary values", () => {
    it("handles 0", () => {
      expect(abbreviateNumber(0)).toBe("0");
    });

    it("handles -1", () => {
      expect(abbreviateNumber(-1)).toBe("-1");
    });

    it("handles -1000 (below 10k threshold)", () => {
      expect(abbreviateNumber(-1000)).toBe("-1000");
    });

    it("handles 999 (below 10k threshold)", () => {
      expect(abbreviateNumber(999)).toBe("999");
    });

    it("handles 1000 (below 10k threshold, not abbreviated)", () => {
      expect(abbreviateNumber(1000)).toBe("1000");
    });

    it("handles 9999 (just below 10k threshold)", () => {
      expect(abbreviateNumber(9999)).toBe("9999");
    });

    it("handles 10000 (exact 10k threshold)", () => {
      expect(abbreviateNumber(10000)).toBe("10k");
    });

    it("handles 999999 (just below 1M threshold)", () => {
      // 999999 rounds to 1000k, which promotes to "1M"
      expect(abbreviateNumber(999999)).toBe("1M");
    });

    it("handles 1000000 (exact 1M threshold)", () => {
      expect(abbreviateNumber(1000000)).toBe("1M");
    });

    it("handles Infinity", () => {
      expect(abbreviateNumber(Infinity)).toBe("Infinity");
    });

    it("handles -Infinity", () => {
      expect(abbreviateNumber(-Infinity)).toBe("-Infinity");
    });

    it("handles NaN", () => {
      expect(abbreviateNumber(NaN)).toBe("NaN");
    });
  });

  describe("trend arrows edge cases", () => {
    it("renders flat trend (no arrow) when current equals previous", () => {
      const item = makeItem({
        title: "Flat",
        body: JSON.stringify({ value: 100, previous: 100 }),
      });
      const layout = flexCfg("row", [
        panelCfg("Flat Trend", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Flat Trend", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      // Flat trend renders no arrow element
      expect(html).not.toContain("stat-trend-up");
      expect(html).not.toContain("stat-trend-down");
      expect(html).toContain("stat-card");
    });

    it("detects very small differences (0.001 increase)", () => {
      const item = makeItem({
        title: "Tiny Up",
        body: JSON.stringify({ value: 1.001, previous: 1.0 }),
      });
      const layout = flexCfg("row", [
        panelCfg("Tiny", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Tiny", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain("stat-trend-up");
    });

    it("detects very small differences (0.001 decrease)", () => {
      const item = makeItem({
        title: "Tiny Down",
        body: JSON.stringify({ value: 0.999, previous: 1.0 }),
      });
      const layout = flexCfg("row", [
        panelCfg("Tiny", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Tiny", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain("stat-trend-down");
    });
  });

  describe("non-numeric counter values", () => {
    it("renders string value 'UP' as-is (no abbreviation)", () => {
      const item = makeItem({
        title: "Status",
        body: JSON.stringify({ value: "UP" }),
      });
      const layout = flexCfg("row", [
        panelCfg("Status", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Status", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain("UP");
      expect(html).toContain("stat-card");
    });

    it("renders string value 'DOWN' as-is", () => {
      const item = makeItem({
        title: "Health",
        body: JSON.stringify({ value: "DOWN" }),
      });
      const layout = flexCfg("row", [
        panelCfg("Health", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Health", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain("DOWN");
      expect(html).toContain("stat-card");
    });

    it("renders no trend arrow for string values with previous set", () => {
      const item = makeItem({
        title: "Mode",
        body: JSON.stringify({ value: "ACTIVE", previous: "INACTIVE" }),
      });
      const layout = flexCfg("row", [
        panelCfg("Mode", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Mode", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      // getTrend returns "none" for non-numeric values
      expect(html).not.toContain("stat-trend-up");
      expect(html).not.toContain("stat-trend-down");
    });
  });

  describe("unit with special characters", () => {
    it("renders unit with forward slash (req/s)", () => {
      const item = makeItem({
        title: "Rate",
        body: JSON.stringify({ value: 500, unit: "req/s" }),
      });
      const layout = flexCfg("row", [
        panelCfg("Rate", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Rate", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain('class="stat-unit">req/s</span>');
    });

    it("renders unit with percent sign", () => {
      const item = makeItem({
        title: "CPU",
        body: JSON.stringify({ value: 85, unit: "%" }),
      });
      const layout = flexCfg("row", [
        panelCfg("CPU", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["CPU", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain('class="stat-unit">%</span>');
    });

    it("renders unit with special HTML chars escaped", () => {
      const item = makeItem({
        title: "Temp",
        body: JSON.stringify({ value: 22, unit: "<hot>" }),
      });
      const layout = flexCfg("row", [
        panelCfg("Temp", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Temp", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      // Hono/JSX should escape the angle brackets
      expect(html).not.toContain("<hot>");
      expect(html).toContain("&lt;hot&gt;");
    });
  });

  describe("many counter items (grid wrapping)", () => {
    it("renders 20+ stat cards in a single counter panel", () => {
      const items = Array.from({ length: 25 }, (_, i) =>
        makeItem({
          id: `counter-${i}`,
          title: `Metric ${i}`,
          body: JSON.stringify({ value: i * 100 }),
        })
      );
      const layout = flexCfg("row", [
        panelCfg("Big Grid", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Big Grid", { items }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      const cardMatches = html.match(/class="stat-card"/g) ?? [];
      expect(cardMatches.length).toBe(25);
      expect(html).toContain("Metric 0");
      expect(html).toContain("Metric 24");
    });
  });

  describe("counter panel aria attributes", () => {
    it("includes role=group and aria-label on stat cards", () => {
      const item = makeItem({
        title: "Stars",
        body: JSON.stringify({ value: 93200, unit: "stars", previous: 90000 }),
      });
      const layout = flexCfg("row", [
        panelCfg("Stats", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Stats", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain('role="group"');
      // aria-label should compose: label, raw value (not abbreviated), unit, trend
      expect(html).toContain('aria-label="Stars, 93200, stars, trending up"');
    });

    it("has aria-hidden=true on trend arrows", () => {
      const item = makeItem({
        title: "Count",
        body: JSON.stringify({ value: 200, previous: 100 }),
      });
      const layout = flexCfg("row", [
        panelCfg("Arrows", "counter", { display: "counter" }),
      ]);
      const panelData = new Map<string, PanelData>([
        ["Arrows", { items: [item] }],
      ]);
      const html = renderDashboard({ layout, panelData, updatedAt: "now" });
      expect(html).toContain('aria-hidden="true"');
    });
  });
});

// ===========================================================================
// TEXT RENDER EDGE CASES (sanitize + renderMarkdown)
// ===========================================================================
describe("text-render additional edge cases", () => {
  it("sanitize preserves br and hr tags", () => {
    expect(sanitize("line<br/>break")).toContain("<br");
    expect(sanitize("<hr/>")).toContain("<hr");
  });

  it("renderMarkdown handles empty string", () => {
    const result = renderMarkdown("");
    // Should not throw, result may be empty or whitespace
    expect(typeof result).toBe("string");
  });

  it("renderMarkdown renders all heading levels", () => {
    const md = "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6";
    const result = renderMarkdown(md);
    for (let i = 1; i <= 6; i++) {
      expect(result).toContain(`<h${i}`);
    }
  });

  it("renderMarkdown renders images with src and alt", () => {
    const result = renderMarkdown("![alt text](https://example.com/pic.png)");
    expect(result).toContain('src="https://example.com/pic.png"');
    expect(result).toContain('alt="alt text"');
  });

  it("sanitize strips disallowed tags (div, span) but keeps table and content", () => {
    const input = "<div><span>hello</span></div><table><tr><td>cell</td></tr></table>";
    const result = sanitize(input);
    expect(result).not.toContain("<div");
    expect(result).not.toContain("<span");
    expect(result).toContain("<table");
    expect(result).toContain("<tr");
    expect(result).toContain("<td");
    expect(result).toContain("hello");
    expect(result).toContain("cell");
  });

  it("renderMarkdown with nested lists (2 levels deep)", () => {
    const md = "- outer\n  - inner\n    - deepest";
    const result = renderMarkdown(md);
    expect(result).toContain("<ul>");
    expect(result).toContain("outer");
    expect(result).toContain("inner");
    expect(result).toContain("deepest");
  });
});

// ===========================================================================
// parseCounterBody edge cases
// ===========================================================================
describe("parseCounterBody edge cases", () => {
  it("returns null for empty string", () => {
    expect(parseCounterBody("")).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseCounterBody(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(parseCounterBody(undefined)).toBeNull();
  });

  it("returns null for JSON without 'value' key", () => {
    expect(parseCounterBody('{"count": 42}')).toBeNull();
  });

  it("returns null for JSON array", () => {
    expect(parseCounterBody("[1, 2, 3]")).toBeNull();
  });

  it("returns null for JSON number", () => {
    expect(parseCounterBody("42")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseCounterBody("{bad json}")).toBeNull();
  });

  it("parses valid counter body with value, unit, and previous", () => {
    const result = parseCounterBody('{"value": 42, "unit": "ms", "previous": 38}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe(42);
    expect(result!.unit).toBe("ms");
    expect(result!.previous).toBe(38);
  });

  it("parses counter body with string value", () => {
    const result = parseCounterBody('{"value": "HEALTHY"}');
    expect(result).not.toBeNull();
    expect(result!.value).toBe("HEALTHY");
  });

  it("parses counter body with null value", () => {
    const result = parseCounterBody('{"value": null}');
    expect(result).not.toBeNull();
    expect(result!.value).toBeNull();
  });
});
