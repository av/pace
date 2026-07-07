import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppConfig } from "./config/types";
import { initDb, saveItems } from "./db";
import {
  exportStaticDashboard,
  renderStaticDashboard,
  STATIC_DASHBOARD_CSS,
  STATIC_DASHBOARD_HTML,
} from "./share-export";
import { makeContentItem } from "./test/content-items";
import { installTempDbHooks } from "./test/temp-db";

describe("static dashboard export", () => {
  installTempDbHooks({ prefix: "pace-share-export-" });

  function withTempDir<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), "pace-share-out-"));
    try {
      return fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("writes a portable HTML and CSS artifact using current DB panel data", () => {
    initDb();
    saveItems("tech-panel", [
      makeContentItem({
        id: "story-1",
        title: "Snapshot Story",
        url: "https://example.com/story",
        source: "secret-feed",
      }),
    ]);

    const config: AppConfig = {
      adapters: [{ type: "rss", name: "secret-feed", params: { url: "https://example.com/feed.xml" } }],
      layout: {
        direction: "row",
        children: [{ panel: "Tech", id: "tech-panel", source: "secret-feed" }],
      },
    };

    withTempDir((outputDir) => {
      const artifact = exportStaticDashboard(config, {
        outputDir,
        now: new Date("2026-06-22T10:11:12Z"),
      });
      const html = readFileSync(artifact.htmlPath, "utf-8");
      const css = readFileSync(artifact.cssPath, "utf-8");

      expect(artifact.files).toEqual([STATIC_DASHBOARD_HTML, STATIC_DASHBOARD_CSS]);
      expect(artifact.htmlPath).toBe(join(outputDir, "index.html"));
      expect(artifact.cssPath).toBe(join(outputDir, "styles.css"));
      expect(html).toContain("Snapshot Story");
      expect(html).toContain('<link rel="stylesheet" href="styles.css"/>');
      expect(html).not.toContain('href="/styles.css"');
      expect(html).toContain("2026-06-22 10:11:12 UTC");
      expect(css).toContain(".flex-root");
      expect(css).toContain(".panel");
    });
  });

  test("omits refresh forms, buttons, and actions from static panel HTML", () => {
    initDb();
    saveItems("links-panel", [
      makeContentItem({ id: "link-1", title: "Read-only Link", source: "links" }),
    ]);
    saveItems("counter-panel", [
      makeContentItem({
        id: "count-1",
        title: "Builds",
        source: "counter",
        body: JSON.stringify({ value: 42, unit: "ok" }),
      }),
    ]);

    const config: AppConfig = {
      adapters: [{ type: "bookmarks", name: "links" }, { type: "counter" }],
      layout: {
        direction: "row",
        children: [
          { panel: "Links", id: "links-panel", source: "links" },
          { panel: "Metrics", id: "counter-panel", source: "counter", display: "counter" },
        ],
      },
    };

    const { html } = renderStaticDashboard(config);

    expect(html).toContain("Read-only Link");
    expect(html).toContain("Builds");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("refresh-btn");
    expect(html).not.toContain("/refresh/");
    expect(html).not.toContain('method="post"');
  });

  test("does not serialize adapter or LLM secrets from config", () => {
    initDb();
    saveItems("secret-panel", [
      makeContentItem({ id: "safe-1", title: "Public Story", source: "secret-feed" }),
    ]);

    const config: AppConfig = {
      adapters: [
        {
          type: "rss",
          name: "secret-feed",
          params: {
            url: "https://example.com/feed.xml",
            headers: { Authorization: "Bearer adapter-secret-token" },
            api_key: "adapter-api-key",
            token: "${PACE_SECRET_TOKEN}",
          },
        },
      ],
      llm: { provider: "openai", api_key: "llm-api-key" },
      layout: {
        direction: "row",
        children: [{ panel: "Public", id: "secret-panel", source: "secret-feed" }],
      },
    };

    const { html } = renderStaticDashboard(config);

    expect(html).toContain("Public Story");
    expect(html).not.toContain("adapter-secret-token");
    expect(html).not.toContain("adapter-api-key");
    expect(html).not.toContain("llm-api-key");
    expect(html).not.toContain("${PACE_SECRET_TOKEN}");
    expect(html).not.toContain("Authorization");
  });

  test("rejects unresolved env placeholders that would render into the artifact", () => {
    const config: AppConfig = {
      adapters: [],
      layout: {
        direction: "row",
        children: [{ text: "Token is ${MISSING_TOKEN}", format: "plain" }],
      },
    };

    expect(() => renderStaticDashboard(config)).toThrow(
      /share: static dashboard contains unresolved env placeholder \$\{MISSING_TOKEN\}/,
    );
  });

  test("rejects unresolved env placeholders in copied CSS", () => {
    const config: AppConfig = {
      adapters: [],
      layout: { direction: "row", children: [] },
    };

    withTempDir((srcDir) => {
      writeFileSync(join(srcDir, STATIC_DASHBOARD_CSS), "body{content:'${CSS_TOKEN}'}");
      expect(() => renderStaticDashboard(config, { srcDir })).toThrow(
        /share: static dashboard contains unresolved env placeholder \$\{CSS_TOKEN\}/,
      );
    });
  });
});
