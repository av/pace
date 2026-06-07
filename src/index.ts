import { Hono } from "hono";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, buildLayoutRuntimeMaps } from "./config";
import { initDb, closeDb } from "./db";
import { discoverAdapters } from "./adapters/index";
import { createModel } from "./llm";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  type SourcePanelMap,
} from "./scheduler";
import { parsePort, getAdapterName } from "./utils";
import { securityHeadersMiddleware } from "./server/security-headers";
import { BUNDLED_STATIC, registerBundledStatic } from "./server/static";
import { registerServerRoutes } from "./server/routes";

const app = new Hono();

app.use("*", securityHeadersMiddleware());

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
  registerServerRoutes(app, {
    layout: config.layout,
    dashboardPanels,
    panelNameToId,
    panelIdToRefreshSourceNames,
    refreshSources,
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