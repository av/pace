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
  getRefreshHealth,
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
  closeDb: (options?: { final?: boolean }) => void;
  discoverAdapters: () => Promise<Map<string, Adapter>>;
  createModel: typeof createModel;
  buildLayoutRuntimeMaps: typeof buildLayoutRuntimeMaps;
  startScheduler: typeof startScheduler;
  stopScheduler: typeof stopScheduler;
  drainScheduler: typeof drainScheduler;
  refreshSources: typeof refreshSources;
  getRefreshHealth: typeof getRefreshHealth;
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
    getRefreshHealth,
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

function isAddrInUseError(err: unknown): boolean {
  if (err && typeof err === "object" && "code" in err && err.code === "EADDRINUSE") {
    return true;
  }
  return err instanceof Error && /EADDRINUSE|address (already )?in use|port .* in use/i.test(err.message);
}

/**
 * Wrap an HTTP bind failure in a `server:`-prefixed error so the CLI prints a
 * clean fatal message (see CLI_FATAL_ERROR_PREFIXES) instead of a raw stack.
 */
export function serverBindError(err: unknown, port: number): Error {
  const reason = err instanceof Error ? err.message : String(err);
  if (isAddrInUseError(err)) {
    return new Error(
      `server: port ${port} is already in use (choose a free port via --port or the PORT env var)`,
    );
  }
  return new Error(`server: failed to start HTTP server on port ${port}: ${reason}`);
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

  const basePath = normalizeBasePath(config.server?.base_path);

  const app = deps.createServerApp({
    layout: config.layout,
    dashboardPanels,
    panelNameToId,
    panelIdToRefreshSourceNames,
    refreshSources: deps.refreshSources,
    basePath,
    getRefreshHealth: deps.getRefreshHealth,
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
    // Final close: a refresh that outlived the drain timeout must fail loudly
    // instead of silently re-opening the DB right before exit.
    deps.closeDb({ final: true });
    deps.exitProcess(0);
  };
  deps.registerShutdown(shutdown);

  // Bind BEFORE starting the scheduler: a doomed process (e.g. port already
  // in use) must not kick off the initial refresh cycle - that would burn
  // network/LLM calls and write to the db right before exiting with an error.
  try {
    httpServer = deps.startHttpServer(port, app.fetch);
  } catch (err) {
    // The scheduler has not started yet, so only the DB handle needs closing
    // before the propagated error aborts startup.
    deps.closeDb();
    throw serverBindError(err, port);
  }

  deps.startScheduler(config, adapters, panelMap, llmModel);
  deps.logServerListening(port);
}
