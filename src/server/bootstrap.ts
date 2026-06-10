import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverAdapters } from "../adapters/index";
import { loadConfig, type AppConfig } from "../config";
import { buildLayoutRuntimeMaps, type Adapter } from "../layout/types";
import { initDb, closeDb } from "../db";
import { createModel } from "../llm";
import {
  startScheduler,
  stopScheduler,
  refreshSources,
  type SourcePanelMap,
} from "../scheduler";
import { parsePort, getAdapterName } from "../utils";
import { logServerListening } from "../server-log";
import { createServerApp } from "./app";

export type BootstrapServerDeps = {
  loadConfig: () => AppConfig;
  ensureDataDir: () => void;
  initDb: () => void;
  closeDb: () => void;
  discoverAdapters: () => Promise<Map<string, Adapter>>;
  createModel: typeof createModel;
  buildLayoutRuntimeMaps: typeof buildLayoutRuntimeMaps;
  startScheduler: typeof startScheduler;
  stopScheduler: typeof stopScheduler;
  refreshSources: typeof refreshSources;
  createServerApp: typeof createServerApp;
  resolvePort: () => number;
  registerShutdown: (handler: () => void) => void;
  startHttpServer: (port: number, fetch: (req: Request) => Response | Promise<Response>) => void;
  logServerListening: typeof logServerListening;
  exitProcess: (code: number) => void;
};

export function defaultBootstrapServerDeps(): BootstrapServerDeps {
  return {
    loadConfig,
    ensureDataDir: () => mkdirSync(join(process.cwd(), "data"), { recursive: true }),
    initDb,
    closeDb,
    discoverAdapters,
    createModel,
    buildLayoutRuntimeMaps,
    startScheduler,
    stopScheduler,
    refreshSources,
    createServerApp,
    resolvePort: () => parsePort(process.env.PORT),
    registerShutdown: (handler) => {
      for (const sig of ["SIGTERM", "SIGINT"] as const) {
        process.on(sig, handler);
      }
    },
    startHttpServer: (port, fetch) => {
      Bun.serve({ port, fetch });
    },
    logServerListening,
    exitProcess: (code) => process.exit(code),
  };
}

/** Load config, init persistence, start scheduler, and bind the dashboard HTTP server. */
export async function bootstrapServer(
  overrides: Partial<BootstrapServerDeps> = {},
): Promise<void> {
  const deps = { ...defaultBootstrapServerDeps(), ...overrides };
  const config = deps.loadConfig();
  const configuredAdapterNames = config.adapters.map(getAdapterName);

  deps.ensureDataDir();
  deps.initDb();

  const adapters = await deps.discoverAdapters();
  const llmModel = config.llm ? deps.createModel(config.llm) : null;

  const {
    sourceToPanels,
    sourceToReadKey,
    panelIdToRefreshSourceNames,
    panelNameToId,
    dashboardPanels,
  } = deps.buildLayoutRuntimeMaps(config.layout, configuredAdapterNames, config.pipelines);

  const panelMap: SourcePanelMap = { sourceToPanels, sourceToReadKey };
  deps.startScheduler(config, adapters, panelMap, llmModel);

  const app = deps.createServerApp({
    layout: config.layout,
    dashboardPanels,
    panelNameToId,
    panelIdToRefreshSourceNames,
    refreshSources: deps.refreshSources,
  });

  const port = deps.resolvePort();

  const shutdown = () => {
    deps.stopScheduler();
    deps.closeDb();
    deps.exitProcess(0);
  };
  deps.registerShutdown(shutdown);

  deps.startHttpServer(port, app.fetch);
  deps.logServerListening(port);
}