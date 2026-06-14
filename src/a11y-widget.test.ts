import { describe, it, expect } from "bun:test";
import { renderDashboard, type PanelData } from "./layout";
import { makeContentItemRow as makeItem } from "./test/content-items";
import { flexCfg, panelCfg } from "./test/layout-cfg";

// ---------------------------------------------------------------------------
// Helper: render a single layout node and return the HTML string
// ---------------------------------------------------------------------------
function renderWidget(node: Parameters<typeof flexCfg>[1][0], panelData?: Map<string, PanelData>): string {
  const layout = flexCfg("row", [node]);
  return renderDashboard({ layout, panelData: panelData ?? new Map(), updatedAt: "now" });
}

// ===========================================================================
// IMAGE WIDGET - WCAG 2.1 Compliance
// ===========================================================================
describe("ImageWidget accessibility", () => {
  it("always has alt attribute present on img element", () => {
    const html = renderWidget({ image: "https://example.com/photo.png", alt: "Photo of sunset" });
    expect(html).toContain('alt="Photo of sunset"');
  });

  it("defaults alt to empty string when not configured", () => {
    const html = renderWidget({ image: "https://example.com/photo.png" });
    expect(html).toContain('alt=""');
  });

  it("marks decorative image (empty alt, no link) with aria-hidden=true", () => {
    const html = renderWidget({ image: "https://example.com/decorative.png" });
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('alt=""');
  });

  it("does NOT mark image with non-empty alt as aria-hidden", () => {
    const html = renderWidget({ image: "https://example.com/important.png", alt: "Important chart" });
    expect(html).not.toContain("aria-hidden");
  });

  it("does NOT mark linked decorative image as aria-hidden (link provides context)", () => {
    const html = renderWidget({ image: "https://example.com/logo.png", link: "https://example.com" });
    // The img itself should NOT be aria-hidden because the link wrapper provides accessible context
    const imgMatch = html.match(/<img[^>]*>/);
    expect(imgMatch).toBeTruthy();
    expect(imgMatch![0]).not.toContain("aria-hidden");
  });

  it("provides aria-label on link wrapper when image has empty alt", () => {
    const html = renderWidget({ image: "https://example.com/logo.png", link: "https://example.com" });
    expect(html).toContain('aria-label="https://example.com"');
  });

  it("does NOT add aria-label on link wrapper when image has non-empty alt", () => {
    const html = renderWidget({ image: "https://example.com/logo.png", alt: "Company Logo", link: "https://example.com" });
    // The alt text serves as the accessible name; no extra aria-label needed
    const linkMatch = html.match(/<a[^>]*>/);
    expect(linkMatch).toBeTruthy();
    expect(linkMatch![0]).not.toContain("aria-label");
  });

  it("link has rel=noopener noreferrer for external links", () => {
    const html = renderWidget({ image: "https://example.com/img.png", link: "https://example.com" });
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("link has target=_blank", () => {
    const html = renderWidget({ image: "https://example.com/img.png", link: "https://example.com" });
    expect(html).toContain('target="_blank"');
  });

  it("img has loading=lazy for performance without blocking accessibility", () => {
    const html = renderWidget({ image: "https://example.com/img.png" });
    expect(html).toContain('loading="lazy"');
  });
});

// ===========================================================================
// TEXT WIDGET - WCAG 2.1 Compliance
// ===========================================================================
describe("TextWidget accessibility", () => {
  it("has role=region on the text body", () => {
    const html = renderWidget({ text: "Hello", format: "plain" });
    expect(html).toContain('role="region"');
  });

  it("has aria-label matching the title when title is provided", () => {
    const html = renderWidget({ text: "Content", title: "My Section", format: "plain" });
    expect(html).toContain('aria-label="My Section"');
  });

  it("falls back to 'Text content' aria-label when no title", () => {
    const html = renderWidget({ text: "Content", format: "plain" });
    expect(html).toContain('aria-label="Text content"');
  });

  it("has tabindex=0 for keyboard navigation", () => {
    const html = renderWidget({ text: "Content", format: "plain" });
    expect(html).toContain('tabindex="0"');
  });

  it("uses h2 for panel header heading level", () => {
    const html = renderWidget({ text: "Content", title: "My Section", format: "plain" });
    expect(html).toContain("<h2>My Section</h2>");
  });

  it("preserves heading hierarchy in markdown (h1-h6 allowed in body)", () => {
    const md = "# Main\n## Sub\n### Detail";
    const html = renderWidget({ text: md, format: "markdown" });
    expect(html).toContain("<h1>Main</h1>");
    expect(html).toContain("<h2>Sub</h2>");
    expect(html).toContain("<h3>Detail</h3>");
  });

  it("preserves links in rendered markdown with href", () => {
    const md = "[Visit site](https://example.com)";
    const html = renderWidget({ text: md, format: "markdown" });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("Visit site</a>");
  });

  it("preserves links in rendered HTML with href", () => {
    const content = '<a href="https://example.com">Visit site</a>';
    const html = renderWidget({ text: content, format: "html" });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain("Visit site</a>");
  });

  it("strips javascript: links from HTML content", () => {
    const content = '<a href="javascript:alert(1)">Click</a>';
    const html = renderWidget({ text: content, format: "html" });
    expect(html).not.toContain("javascript:");
  });

  it("strips javascript: links from markdown content", () => {
    const md = "[Click](javascript:alert(1))";
    const html = renderWidget({ text: md, format: "markdown" });
    expect(html).not.toContain("javascript:");
  });

  it("img elements in markdown retain alt attribute", () => {
    const md = "![Alt description](https://example.com/img.png)";
    const html = renderWidget({ text: md, format: "markdown" });
    expect(html).toContain('alt="Alt description"');
  });

  it("region and aria-label co-locate on the same element", () => {
    const html = renderWidget({ text: "Content", title: "Test", format: "plain" });
    // Both role and aria-label should be on the text-widget-body div
    const bodyMatch = html.match(/class="text-widget-body"[^>]*/);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch![0]).toContain('role="region"');
    expect(bodyMatch![0]).toContain('aria-label="Test"');
    expect(bodyMatch![0]).toContain('tabindex="0"');
  });
});

// ===========================================================================
// IFRAME WIDGET - WCAG 2.1 Compliance
// ===========================================================================
describe("IframeWidget accessibility", () => {
  it("has title attribute on iframe element", () => {
    const html = renderWidget({ iframe: "https://example.com/embed", title: "My Embed" });
    expect(html).toContain('title="My Embed"');
  });

  it("falls back to meaningful title from hostname when not configured", () => {
    const html = renderWidget({ iframe: "https://weather.example.com/widget" });
    expect(html).toContain('title="Embedded content from weather.example.com"');
  });

  it("falls back to localhost hostname for invalid URLs", () => {
    const html = renderWidget({ iframe: "/relative/path" });
    expect(html).toContain('title="Embedded content from localhost"');
  });

  it("has role=region on the iframe container", () => {
    const html = renderWidget({ iframe: "https://example.com/embed", title: "Weather" });
    const iframePanelMatch = html.match(/class="iframe-panel"[^>]*/);
    expect(iframePanelMatch).toBeTruthy();
    expect(iframePanelMatch![0]).toContain('role="region"');
  });

  it("has aria-label on iframe container matching the title", () => {
    const html = renderWidget({ iframe: "https://example.com/embed", title: "Weather Widget" });
    const iframePanelMatch = html.match(/class="iframe-panel"[^>]*/);
    expect(iframePanelMatch).toBeTruthy();
    expect(iframePanelMatch![0]).toContain('aria-label="Weather Widget"');
  });

  it("has aria-label on iframe container matching the fallback title", () => {
    const html = renderWidget({ iframe: "https://maps.example.com/view" });
    const iframePanelMatch = html.match(/class="iframe-panel"[^>]*/);
    expect(iframePanelMatch).toBeTruthy();
    expect(iframePanelMatch![0]).toContain('aria-label="Embedded content from maps.example.com"');
  });

  it("does not set tabindex=-1 on iframe (allows keyboard focus)", () => {
    const html = renderWidget({ iframe: "https://example.com/embed" });
    const iframeMatch = html.match(/<iframe[^>]*>/);
    expect(iframeMatch).toBeTruthy();
    expect(iframeMatch![0]).not.toContain('tabindex="-1"');
  });

  it("has referrerpolicy=no-referrer for privacy", () => {
    const html = renderWidget({ iframe: "https://example.com/embed" });
    expect(html).toContain('referrerpolicy="no-referrer"');
  });

  it("uses h2 for panel header when title is set", () => {
    const html = renderWidget({ iframe: "https://example.com/embed", title: "Live Feed" });
    expect(html).toContain("<h2>Live Feed</h2>");
  });
});

// ===========================================================================
// COUNTER PANEL - WCAG 2.1 Compliance
// ===========================================================================
describe("CounterPanel accessibility", () => {
  function counterPanelData(items: { title: string; body: string }[]): Map<string, PanelData> {
    const rows = items.map((item) => makeItem({ title: item.title, body: item.body }));
    return new Map([["Metrics", { items: rows }]]);
  }

  const metricsPanel = panelCfg("Metrics", "counter", { display: "counter" });

  it("stat cards have role=group", () => {
    const pd = counterPanelData([{ title: "Count", body: JSON.stringify({ value: 42 }) }]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('role="group"');
  });

  it("aria-label includes full context: label, raw value, unit, trend", () => {
    const pd = counterPanelData([
      { title: "Stars", body: JSON.stringify({ value: 93200, unit: "stars", previous: 90000 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    // Screen readers get the raw number, not the abbreviated "93.2k"
    expect(html).toContain('aria-label="Stars, 93200, stars, trending up"');
    // Visual display still shows abbreviated form
    expect(html).toContain("93.2k");
  });

  it("aria-label uses raw value even for millions", () => {
    const pd = counterPanelData([
      { title: "Downloads", body: JSON.stringify({ value: 2500000, unit: "total" }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    // Visual: 2.5M, aria-label: 2500000
    expect(html).toContain("2.5M");
    expect(html).toContain('aria-label="Downloads, 2500000, total"');
  });

  it("aria-label omits trend text when no previous value", () => {
    const pd = counterPanelData([
      { title: "Users", body: JSON.stringify({ value: 1000, unit: "active" }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Users, 1000, active"');
  });

  it("aria-label includes trend text for down trend", () => {
    const pd = counterPanelData([
      { title: "Errors", body: JSON.stringify({ value: 5, unit: "count", previous: 20 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Errors, 5, count, trending down"');
  });

  it("aria-label includes 'unchanged' for flat trend", () => {
    const pd = counterPanelData([
      { title: "Uptime", body: JSON.stringify({ value: 99.9, unit: "%", previous: 99.9 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Uptime, 99.9, %, unchanged"');
  });

  it("trend arrows are aria-hidden=true (decorative)", () => {
    const pd = counterPanelData([
      { title: "Count", body: JSON.stringify({ value: 200, previous: 100 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-hidden="true"');
  });

  it("trend arrows have title attribute for sighted tooltip", () => {
    const pd = counterPanelData([
      { title: "Up", body: JSON.stringify({ value: 200, previous: 100 }) },
      { title: "Down", body: JSON.stringify({ value: 50, previous: 100 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('title="Increasing"');
    expect(html).toContain('title="Decreasing"');
  });

  it("counter panel container has aria-live=polite for dynamic updates", () => {
    const pd = counterPanelData([
      { title: "Test", body: JSON.stringify({ value: 1 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-live="polite"');
  });

  it("empty state is inside aria-live region", () => {
    const html = renderWidget(metricsPanel, new Map());
    // The counter-panel div has aria-live, and empty state is inside it
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("No data yet");
  });

  it("refresh button has aria-label for screen readers", () => {
    const pd = counterPanelData([
      { title: "Test", body: JSON.stringify({ value: 1 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Refresh"');
  });

  it("refresh button also has title for sighted tooltip", () => {
    const pd = counterPanelData([
      { title: "Test", body: JSON.stringify({ value: 1 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    const buttonMatch = html.match(/<button[^>]*>/);
    expect(buttonMatch).toBeTruthy();
    expect(buttonMatch![0]).toContain('title="Refresh"');
    expect(buttonMatch![0]).toContain('aria-label="Refresh"');
  });

  it("panel header uses h2 for consistent heading hierarchy", () => {
    const pd = counterPanelData([
      { title: "Test", body: JSON.stringify({ value: 1 }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain("<h2>Metrics</h2>");
  });

  it("aria-label works for non-numeric string values", () => {
    const pd = counterPanelData([
      { title: "Status", body: JSON.stringify({ value: "ACTIVE" }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Status, ACTIVE"');
  });

  it("multiple stat cards each have independent aria-labels", () => {
    const pd = counterPanelData([
      { title: "Stars", body: JSON.stringify({ value: 1000, unit: "count" }) },
      { title: "Forks", body: JSON.stringify({ value: 200, unit: "count" }) },
    ]);
    const html = renderWidget(metricsPanel, pd);
    expect(html).toContain('aria-label="Stars, 1000, count"');
    expect(html).toContain('aria-label="Forks, 200, count"');
  });
});

// ===========================================================================
// CROSS-WIDGET HEADING HIERARCHY
// ===========================================================================
describe("Widget heading hierarchy", () => {
  it("all widget types use h2 in panel headers for consistent hierarchy", () => {
    // Text widget with title
    const textHtml = renderWidget({ text: "Content", title: "Text Section", format: "plain" });
    expect(textHtml).toContain("<h2>Text Section</h2>");

    // Iframe widget with title
    const iframeHtml = renderWidget({ iframe: "https://example.com", title: "Iframe Section" });
    expect(iframeHtml).toContain("<h2>Iframe Section</h2>");

    // Counter panel
    const pd = new Map<string, PanelData>([
      ["Counter Section", { items: [] }],
    ]);
    const counterHtml = renderWidget(panelCfg("Counter Section", "counter", { display: "counter" }), pd);
    expect(counterHtml).toContain("<h2>Counter Section</h2>");
  });

  it("h1 in markdown body does not conflict with panel h2 header", () => {
    const html = renderWidget({ text: "# Top Heading\nContent", title: "Panel Title", format: "markdown" });
    // Panel header is h2
    expect(html).toContain("<h2>Panel Title</h2>");
    // Body heading is h1 (inside the region)
    expect(html).toContain("<h1>Top Heading</h1>");
  });
});

// ===========================================================================
// KEYBOARD NAVIGATION
// ===========================================================================
describe("Widget keyboard navigation", () => {
  it("text widget body is focusable via tabindex=0", () => {
    const html = renderWidget({ text: "Scrollable content", format: "plain" });
    const bodyMatch = html.match(/class="text-widget-body"[^>]*/);
    expect(bodyMatch).toBeTruthy();
    expect(bodyMatch![0]).toContain('tabindex="0"');
  });

  it("iframe is keyboard-focusable by default (no negative tabindex)", () => {
    const html = renderWidget({ iframe: "https://example.com" });
    const iframeMatch = html.match(/<iframe[^>]*/);
    expect(iframeMatch).toBeTruthy();
    expect(iframeMatch![0]).not.toContain("tabindex");
  });

  it("linked image is keyboard-focusable via anchor element", () => {
    const html = renderWidget({ image: "https://example.com/img.png", link: "https://example.com" });
    expect(html).toContain("<a ");
    expect(html).toContain('href="https://example.com"');
  });

  it("counter panel refresh button is a standard submit button (keyboard accessible)", () => {
    const pd = new Map<string, PanelData>([
      ["Panel", { items: [makeItem({ body: JSON.stringify({ value: 1 }) })] }],
    ]);
    const html = renderWidget(panelCfg("Panel", "counter", { display: "counter" }), pd);
    expect(html).toContain('type="submit"');
  });
});

// ===========================================================================
// SCREEN READER FRIENDLY TEXT
// ===========================================================================
describe("Screen reader friendly text", () => {
  it("counter aria-label never includes abbreviated value like 'k' or 'M'", () => {
    const items = [
      { title: "Small", body: JSON.stringify({ value: 500 }) },
      { title: "Medium", body: JSON.stringify({ value: 50000 }) },
      { title: "Large", body: JSON.stringify({ value: 5000000 }) },
    ];
    const pd = new Map<string, PanelData>([
      ["Nums", { items: items.map((i) => makeItem({ title: i.title, body: i.body })) }],
    ]);
    const html = renderWidget(panelCfg("Nums", "counter", { display: "counter" }), pd);

    // Extract all aria-label values
    const ariaLabels = html.match(/aria-label="[^"]*"/g) ?? [];
    // Filter to stat-card ones (they follow role="group")
    const statLabels = ariaLabels.filter((l) => l.includes("Small") || l.includes("Medium") || l.includes("Large"));

    expect(statLabels).toHaveLength(3);
    // None should contain abbreviated forms
    expect(statLabels.join()).toContain("500");
    expect(statLabels.join()).toContain("50000");
    expect(statLabels.join()).toContain("5000000");
    // But abbreviated forms still appear in visual display
    expect(html).toContain("50k");
    expect(html).toContain("5M");
  });

  it("image widget link aria-label provides full URL context", () => {
    const html = renderWidget({
      image: "https://example.com/img.png",
      link: "https://docs.example.com/getting-started",
    });
    expect(html).toContain('aria-label="https://docs.example.com/getting-started"');
  });

  it("text widget region aria-label matches visible title", () => {
    const html = renderWidget({ text: "Content", title: "Release Notes", format: "plain" });
    expect(html).toContain('aria-label="Release Notes"');
    // Visible title also present
    expect(html).toContain("<h2>Release Notes</h2>");
  });

  it("iframe title provides context about embedded content source", () => {
    const html = renderWidget({ iframe: "https://grafana.internal.io/dashboard/42" });
    expect(html).toContain('title="Embedded content from grafana.internal.io"');
  });
});
