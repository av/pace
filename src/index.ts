import { Hono } from "hono";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, collectPanels, normalizeSource, isPanel, type PanelConfig, type LayoutNodeConfig } from "./config";
import { initDb, closeDb, getRecentItems, getItemsByAdapter, getLastFetchedAt, getLastFetchedAtAll, type ContentItemRow } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard, type PanelData } from "./layout";
import { createModel } from "./llm";
import { startScheduler, stopScheduler, refreshSources } from "./scheduler";

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
});

const config = loadConfig();

mkdirSync(join(process.cwd(), "data"), { recursive: true });
initDb();

const adapters = await discoverAdapters();
const llmModel = config.llm ? createModel(config.llm) : null;

startScheduler(config, adapters, llmModel);

const cssContent = readFileSync(join(import.meta.dir, "styles.css"), "utf-8");
app.get("/styles.css", (c) => {
  return c.body(cssContent, 200, { "Content-Type": "text/css", "Cache-Control": "public, max-age=3600" });
});

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/", async (c) => {
  const panels = collectPanels(config.layout);
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const panelData = new Map<string, PanelData>();

  for (const panel of panels) {
    const sources = normalizeSource(panel.source);
    const limit = panel.limit ?? 50;
    let items: ContentItemRow[] = [];

    for (const source of sources) {
      const rows =
        source.adapter === "all"
          ? getRecentItems(limit)
          : getItemsByAdapter(source.adapter, limit);
      items = items.concat(rows);
    }

    if (sources.length > 1) {
      items.sort((a, b) => (b.timestamp > a.timestamp ? 1 : b.timestamp < a.timestamp ? -1 : 0));
      items = items.slice(0, limit);
    }

    let lastRefreshedAt: string | null = null;
    for (const src of sources) {
      const ts = src.adapter === "all" ? getLastFetchedAtAll() : getLastFetchedAt(src.adapter);
      if (ts && (!lastRefreshedAt || ts > lastRefreshedAt)) lastRefreshedAt = ts;
    }

    panelData.set(panel.panel, { items, lastRefreshedAt });
  }

  const content = renderDashboard({ layout: config.layout, panelData, updatedAt: now });
  return c.html(content);
});

const allPanels = collectPanels(config.layout);
const panelSourceMap = new Map(allPanels.map((p) => [p.panel, normalizeSource(p.source)]));
const configuredAdapterNames = config.adapters.map((adapter) => adapter.name ?? adapter.type);

app.post("/refresh/:panel", async (c) => {
  const panelId = c.req.param("panel");
  const sources = panelSourceMap.get(panelId);
  if (!sources) return c.text(`Unknown panel: ${panelId}`, 404);

  const sourceNames = Array.from(new Set(sources.flatMap((s) =>
    s.adapter === "all" ? configuredAdapterNames : [s.adapter]
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

const parsedPort = parseInt(process.env.PORT ?? "3000", 10);
const port = isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535 ? 3000 : parsedPort;

process.on("SIGTERM", () => { stopScheduler(); closeDb(); process.exit(0); });
process.on("SIGINT", () => { stopScheduler(); closeDb(); process.exit(0); });

Bun.serve({ port, fetch: app.fetch });
console.log(`pace listening on http://localhost:${port}`);
