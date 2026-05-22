import { Hono } from "hono";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, collectPanels, normalizeSource, resolvePanelId } from "./config";
import { initDb, closeDb, getRecentItems, getItemsByPanel, getLastFetchedAt, getLastFetchedAtAll, type ContentItemRow } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard, type PanelData } from "./layout";
import { createModel } from "./llm";
import { startScheduler, stopScheduler, refreshSources, type SourcePanelMap } from "./scheduler";
import { parsePort, getAdapterName } from "./adapters/types";

/** Single source of truth for the special "all" adapter sentinel (used in source mapping, dashboard "recent" fallback, and refresh expansion). */
function isAllAdapter(adapter: string): boolean {
  return adapter === "all";
}

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
});

async function start() {
  const config = loadConfig();

  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  initDb();

  const adapters = await discoverAdapters();
  const llmModel = config.llm ? createModel(config.llm) : null;

  const allPanelConfigs = collectPanels(config.layout);
  const enrichedPanels = allPanelConfigs.map((panel) => {
    const sources = normalizeSource(panel.source);
    const isAll = sources.some((s) => isAllAdapter(s.adapter));
    return {
      panel,
      pid: resolvePanelId(panel),
      sources,
      isAll,
    };
  });
  const sourceToPanels = new Map<string, string[]>();
  const sourceToReadKey = new Map<string, string>();
  const panelIdToSources = new Map<string, ReturnType<typeof normalizeSource>>();
  const panelNameToId = new Map<string, string>();

  for (const { panel, pid, sources, isAll } of enrichedPanels) {
    panelIdToSources.set(pid, sources);
    panelNameToId.set(panel.panel, pid);
    if (isAll) continue;
    for (const source of sources) {
      const list = sourceToPanels.get(source.adapter) ?? [];
      list.push(pid);
      sourceToPanels.set(source.adapter, list);
      if (!sourceToReadKey.has(source.adapter)) {
        sourceToReadKey.set(source.adapter, pid);
      }
    }
  }

  for (const adapterCfg of config.adapters) {
    const name = getAdapterName(adapterCfg);
    if (!sourceToPanels.has(name)) {
      sourceToPanels.set(name, [name]);
      sourceToReadKey.set(name, name);
    }
  }

  const panelMap: SourcePanelMap = { sourceToPanels, sourceToReadKey };
  startScheduler(config, adapters, panelMap, llmModel);

  const cssContent = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
  app.get("/styles.css", (c) => {
    return c.body(cssContent, 200, { "Content-Type": "text/css", "Cache-Control": "public, max-age=3600" });
  });

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/", async (c) => {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const panelData = new Map<string, PanelData>();

    for (const { panel, pid, sources, isAll } of enrichedPanels) {
      const limit = panel.limit ?? 50;
      let items: ContentItemRow[];

      if (isAll) {
        items = getRecentItems(limit);
      } else {
        items = getItemsByPanel(pid, limit);
      }

      const lastRefreshedAt = isAll ? getLastFetchedAtAll() : getLastFetchedAt(pid);

      panelData.set(panel.panel, { items, lastRefreshedAt });
    }

    const content = renderDashboard({ layout: config.layout, panelData, updatedAt: now });
    return c.html(content);
  });

  app.post("/refresh/:panel", async (c) => {
    const param = c.req.param("panel");
    const panelId = panelNameToId.get(param) ?? param;
    const sources = panelIdToSources.get(panelId);
    if (!sources) return c.text(`Unknown panel: ${param}`, 404);

    const sourceNames = Array.from(new Set(sources.flatMap((s) =>
      isAllAdapter(s.adapter) ? config.adapters.map(getAdapterName) : [s.adapter]
    )));

    if (sourceNames.length > 0) {
      const results = await refreshSources(sourceNames);
      const failures = results.filter((result) => result.status === "failed");
      if (failures.length > 0) {
        const details = failures
          .map((result) => `${result.name}${result.error ? `: ${result.error}` : ""}`)
          .join("; ");
        return c.text(`Refresh failed for ${details}`, 502);
      }
    }

    return c.redirect("/", 303);
  });

  const port = parsePort(process.env.PORT, 3000);

  const shutdown = () => {
    stopScheduler();
    closeDb();
    process.exit(0);
  };
  ["SIGTERM", "SIGINT"].forEach((sig) => process.on(sig, shutdown));

  Bun.serve({ port, fetch: app.fetch });
  console.log(`pace listening on http://localhost:${port}`);
}

await start();
