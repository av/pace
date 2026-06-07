import { Hono } from "hono";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, buildLayoutRuntimeMaps } from "./config";
import { initDb, closeDb, loadDashboardPanelData } from "./db";
import { discoverAdapters } from "./adapters/index";
import { renderDashboard, type PanelData } from "./layout";
import { createModel } from "./llm";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  type SourcePanelMap,
} from "./scheduler";
import { parsePort, getAdapterName, errorMessage } from "./utils";

const SRC_DIR = import.meta.dir;

type BundledStatic = {
  route: `/${string}`;
  file: string;
  contentType: string;
};

const BUNDLED_STATIC: BundledStatic[] = [
  { route: "/styles.css", file: "styles.css", contentType: "text/css" },
];

function readBundledText(file: string): string {
  try {
    return readFileSync(join(SRC_DIR, file), "utf-8");
  } catch (err) {
    throw new Error(`index: failed to read ${file}: ${errorMessage(err)}`);
  }
}

function registerBundledStatic(app: Hono, assets: BundledStatic[]): void {
  for (const { route, file, contentType } of assets) {
    const body = readBundledText(file);
    app.get(route, (c) =>
      c.body(body, 200, {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      }),
    );
  }
}

const app = new Hono();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'");
  c.header("Permissions-Policy", "interest-cohort=()");
});

async function start() {
  const config = loadConfig();
  const configuredAdapterNames = config.adapters.map(getAdapterName);

  mkdirSync(join(process.cwd(), "data"), { recursive: true });
  initDb();

  const adapters = await discoverAdapters();
  const llmModel = config.llm ? createModel(config.llm) : null;

  const {
    sourceToPanels,
    sourceToReadKey,
    panelIdToRefreshSourceNames,
    panelNameToId,
    dashboardPanels,
  } = buildLayoutRuntimeMaps(config.layout, configuredAdapterNames, config.pipelines);

  const panelMap: SourcePanelMap = { sourceToPanels, sourceToReadKey };
  startScheduler(config, adapters, panelMap, llmModel);

  registerBundledStatic(app, BUNDLED_STATIC);

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.get("/", async (c) => {
    const now = new Date().toISOString().replace("T", " ").slice(0, 19);
    const panelData = new Map<string, PanelData>();

    for (const { panel, pid, isAll } of dashboardPanels) {
      const limit = panel.limit ?? 50;
      panelData.set(panel.panel, loadDashboardPanelData(pid, isAll, limit));
    }

    const content = renderDashboard({ layout: config.layout, panelData, updatedAt: now });
    return c.html(content);
  });

  app.post("/refresh/:panel", async (c) => {
    const param = c.req.param("panel");
    const panelId = panelNameToId.get(param) ?? param;
    const sourceNames = panelIdToRefreshSourceNames.get(panelId);
    if (!sourceNames) return c.text(`Unknown panel: ${param}`, 404);

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

  const port = parsePort(process.env.PORT);

  const shutdown = () => {
    stopScheduler();
    closeDb();
    process.exit(0);
  };
  ["SIGTERM", "SIGINT"].forEach((sig) => process.on(sig, shutdown));

  Bun.serve({ port, fetch: app.fetch });
  console.log(`index: listening on http://localhost:${port}`);
}

await start();
