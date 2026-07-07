import { describe, it, expect } from "bun:test";
import { renderDashboard } from "../layout";
import { isSafeEmbedUrl } from "../config-validate";
import { spyConsole, spyMockCallsContaining } from "../test/console-spy";
import type { IframeWidgetConfig, ImageWidgetConfig } from "./types";

// Render-time src guards for iframe/image widgets: config validation covers
// YAML configs, but programmatic AppConfig reaches the renderer unvalidated.
// These tests exercise the renderer directly with hostile widget configs.

const panelData = new Map();

function render(node: IframeWidgetConfig | ImageWidgetConfig): string {
  return renderDashboard({ layout: node, panelData, updatedAt: "now" });
}

describe("isSafeEmbedUrl", () => {
  it("accepts https anywhere and http on localhost only", () => {
    expect(isSafeEmbedUrl("https://example.com/embed")).toBe(true);
    expect(isSafeEmbedUrl("http://localhost:7453/x")).toBe(true);
    expect(isSafeEmbedUrl("http://127.0.0.1/x")).toBe(true);
    expect(isSafeEmbedUrl("http://[::1]:3000/x")).toBe(true);
    expect(isSafeEmbedUrl("http://example.com/embed")).toBe(false);
  });

  it("rejects script-capable and non-web schemes", () => {
    expect(isSafeEmbedUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeEmbedUrl("JavaScript:alert(1)")).toBe(false);
    expect(isSafeEmbedUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeEmbedUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeEmbedUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects non-strings, empty, and unparseable values", () => {
    expect(isSafeEmbedUrl(undefined)).toBe(false);
    expect(isSafeEmbedUrl(42)).toBe(false);
    expect(isSafeEmbedUrl("")).toBe(false);
    expect(isSafeEmbedUrl("http://")).toBe(false);
    expect(isSafeEmbedUrl("/relative/path")).toBe(false);
  });
});

describe("iframe widget render-time src guard", () => {
  it("does not emit an iframe for a javascript: src and warns", async () => {
    await spyConsole(["warn"], async (spies) => {
      const html = render({ iframe: "javascript:alert(1)", title: "evil" });
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("javascript:alert(1)");
      expect(html).toContain("Embedded content blocked");
      expect(html).toContain("evil"); // header still rendered
      expect(spyMockCallsContaining(spies.warn, "iframe src blocked").length).toBe(1);
    });
  });

  it("does not emit an iframe for a data: src", async () => {
    await spyConsole(["warn"], async () => {
      const html = render({ iframe: "data:text/html,<script>alert(1)</script>" });
      expect(html).not.toContain("<iframe");
      expect(html).not.toContain("data:text/html");
    });
  });

  it("does not throw on an unparseable src (previously crashed the whole render)", async () => {
    await spyConsole(["warn"], async () => {
      const html = render({ iframe: "http://" });
      expect(html).not.toContain("<iframe");
      expect(html).toContain("Embedded content blocked");
    });
  });

  it("still renders a normal https iframe", () => {
    const html = render({ iframe: "https://example.com/embed" });
    expect(html).toContain('<iframe src="https://example.com/embed"');
    expect(html).toContain("Embedded content from example.com");
  });
});

describe("image widget render-time src guard", () => {
  it("does not emit an img for a javascript: src and warns", async () => {
    await spyConsole(["warn"], async (spies) => {
      const html = render({ image: "javascript:alert(1)" });
      expect(html).not.toContain("<img");
      expect(html).not.toContain("javascript:alert(1)");
      expect(spyMockCallsContaining(spies.warn, "image src blocked").length).toBe(1);
    });
  });

  it("does not emit an img for a data: src", async () => {
    await spyConsole(["warn"], async () => {
      const html = render({ image: "data:image/svg+xml,<svg onload=alert(1)/>" });
      expect(html).not.toContain("<img");
    });
  });

  it("still renders a normal https img, including its safe link", () => {
    const html = render({ image: "https://example.com/pic.png", link: "https://example.com/", alt: "pic" });
    expect(html).toContain('src="https://example.com/pic.png"');
    expect(html).toContain('href="https://example.com/"');
  });
});
