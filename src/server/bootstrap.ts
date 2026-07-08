import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { discoverAdapters } from "../adapters/index";
import { loadConfig } from "../config";
import type { AppConfig } from "../config/types";
import { buildLayoutRuntimeMaps, type Adapter } from "../layout/types";
import { initDb, closeDb } from "../db";
import { createModel } from "../llm";
import {
  startScheduler,
  stopScheduler,
  drainScheduler,
  refreshSources,
  type SourcePanelMap,
} from "../scheduler";
import { parsePort, getAdapterName } from "../utils";
import { normalizeBasePath } from "../config/domain";
import { logServerListening } from "../server-log";
import { createServerApp } from "./app";

/** How long shutdown waits for in-flight refreshes before closing the DB. */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 10_000;

export type HttpServerHandle = {
  /** Stop accepting new connections; may resolve once in-flight requests end. */
  stop: () => void | Promise<void>;
};

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
  drainScheduler: typeof drainScheduler;
  refreshSources: typeof refreshSources;
  createServerApp: typeof createServerApp;
  resolvePort: () => number;
  registerShutdown: (handler: () => Promise<void>) => void;
  startHttpServer: (
    port: number,
    fetch: (req: Request) => Response | Promise<Response>,
  ) => HttpServerHandle;
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
    drainScheduler,
    refreshSources,
    createServerApp,
    resolvePort: () => parsePort(process.env.PORT),
    registerShutdown: (handler) => {
      for (const sig of ["SIGTERM", "SIGINT"] as const) {
        process.on(sig, handler);
      }
    },
    startHttpServer: (port, fetch) => {
      const server = Bun.serve({ port, fetch });
      return { stop: () => server.stop() };
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

  const basePath = normalizeBasePath(config.server?.base_path);

  const app = deps.createServerApp({
    layout: config.layout,
    dashboardPanels,
    panelNameToId,
    panelIdToRefreshSourceNames,
    refreshSources: deps.refreshSources,
    basePath,
  });

  const port = deps.resolvePort();

  let httpServer: HttpServerHandle | null = null;
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    // Idempotent: SIGTERM and SIGINT (or a repeated Ctrl+C) must not run the
    // teardown twice - the second closeDb/exit would race the first.
    if (shuttingDown) return;
    shuttingDown = true;
    // Order matters: stop timers so no new refreshes start, stop accepting
    // HTTP connections, wait (bounded) for in-flight refreshes, THEN close
    // the DB so nothing writes to a closed handle. Exit last.
    deps.stopScheduler();
    try {
      await httpServer?.stop();
    } catch {
      // Never let a listener-stop failure block DB close and exit.
    }
    await deps.drainScheduler(SHUTDOWN_DRAIN_TIMEOUT_MS);
    deps.closeDb();
    deps.exitProcess(0);
  };
  deps.registerShutdown(shutdown);

  httpServer = deps.startHttpServer(port, app.fetch);
  deps.logServerListening(port);
}