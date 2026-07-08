import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { buildLayoutRuntimeMaps, type Adapter } from "../layout/types";
import { singlePanelLayout, testAppConfig } from "../test/app-config";
import { bootstrapServer, type BootstrapServerDeps } from "./bootstrap";

type TrackedBootstrapDeps = BootstrapServerDeps & {
  calls: string[];
  shutdownHandlers: Array<() => Promise<void>>;
  served: { port: number; fetch: (req: Request) => Response | Promise<Response> } | null;
};

function trackBootstrapDeps(deps: BootstrapServerDeps): TrackedBootstrapDeps {
  const calls: string[] = [];
  const shutdownHandlers: Array<() => Promise<void>> = [];
  let served: { port: number; fetch: (req: Request) => Response | Promise<Response> } | null = null;

  const tracked = {
    ...deps,
    calls,
    shutdownHandlers,
    served: null as TrackedBootstrapDeps["served"],
    loadConfig: () => {
      calls.push("loadConfig");
      return deps.loadConfig();
    },
    ensureDataDir: () => {
      calls.push("ensureDataDir");
      deps.ensureDataDir();
    },
    initDb: () => {
      calls.push("initDb");
      deps.initDb();
    },
    closeDb: () => {
      calls.push("closeDb");
      deps.closeDb();
    },
    discoverAdapters: async () => {
      calls.push("discoverAdapters");
      return deps.discoverAdapters();
    },
    createModel: (...args) => {
      calls.push("createModel");
      return deps.createModel(...args);
    },
    startScheduler: (...args) => {
      calls.push("startScheduler");
      deps.startScheduler(...args);
    },
    stopScheduler: () => {
      calls.push("stopScheduler");
      deps.stopScheduler();
    },
    drainScheduler: async (timeoutMs) => {
      calls.push("drainScheduler");
      return deps.drainScheduler(timeoutMs);
    },
    refreshSources: async (...args) => {
      calls.push("refreshSources");
      return deps.refreshSources(...args);
    },
    createServerApp: (routeDeps) => {
      calls.push("createServerApp");
      return deps.createServerApp(routeDeps);
    },
    resolvePort: () => {
      calls.push("resolvePort");
      return deps.resolvePort();
    },
    registerShutdown: (handler) => {
      calls.push("registerShutdown");
      shutdownHandlers.push(handler);
      deps.registerShutdown(handler);
    },
    startHttpServer: (port, fetch) => {
      calls.push("startHttpServer");
      tracked.served = { port, fetch };
      const handle = deps.startHttpServer(port, fetch);
      return {
        stop: () => {
          calls.push("httpServerStop");
          return handle.stop();
        },
      };
    },
    logServerListening: (port) => {
      calls.push(`logServerListening:${port}`);
      deps.logServerListening(port);
    },
    exitProcess: (code) => {
      calls.push(`exitProcess:${code}`);
      deps.exitProcess(code);
    },
  } satisfies TrackedBootstrapDeps;

  return tracked;
}

function baseBootstrapDeps(): BootstrapServerDeps {
  const config = testAppConfig(
    { adapters: [{ type: "hackernews", refresh_interval: 15 }] },
    singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }),
  );
  const adapters = new Map<string, Adapter>([
    [
      "hackernews",
      {
        name: "hackernews",
        fetch: async () => [],
      },
    ],
  ]);
  return {
    loadConfig: () => config,
    ensureDataDir: () => {},
    initDb: () => {},
    closeDb: () => {},
    discoverAdapters: async () => adapters,
    createModel: () => null,
    buildLayoutRuntimeMaps,
    startScheduler: () => {},
    stopScheduler: () => {},
    drainScheduler: async () => {},
    refreshSources: async () => [],
    createServerApp: () => new Hono(),
    resolvePort: () => 8123,
    registerShutdown: () => {},
    startHttpServer: () => ({ stop: () => {} }),
    logServerListening: () => {},
    exitProcess: () => {},
  };
}

describe("bootstrapServer", () => {
  test("runs startup pipeline in order and binds HTTP server", async () => {
    const deps = trackBootstrapDeps(baseBootstrapDeps());

    await bootstrapServer(deps);

    expect(deps.calls).toEqual([
      "loadConfig",
      "ensureDataDir",
      "initDb",
      "discoverAdapters",
      "startScheduler",
      "createServerApp",
      "resolvePort",
      "registerShutdown",
      "startHttpServer",
      "logServerListening:8123",
    ]);
    expect(deps.served?.port).toBe(8123);
    expect(deps.shutdownHandlers).toHaveLength(1);
  });

  test("shutdown handler stops scheduler, closes db, and exits", async () => {
    const deps = trackBootstrapDeps(baseBootstrapDeps());
    await bootstrapServer(deps);

    await deps.shutdownHandlers[0]!();

    expect(deps.calls).toContain("stopScheduler");
    expect(deps.calls).toContain("closeDb");
    expect(deps.calls).toContain("exitProcess:0");
  });

  test("shutdown orders teardown: stop scheduler, stop http, drain, close db, exit", async () => {
    const deps = trackBootstrapDeps(baseBootstrapDeps());
    await bootstrapServer(deps);

    deps.calls.length = 0;
    await deps.shutdownHandlers[0]!();

    expect(deps.calls).toEqual([
      "stopScheduler",
      "httpServerStop",
      "drainScheduler",
      "closeDb",
      "exitProcess:0",
    ]);
  });

  test("shutdown waits for in-flight refreshes to drain before closing db", async () => {
    let releaseDrain: () => void = () => {};
    const drainGate = new Promise<void>((resolve) => {
      releaseDrain = resolve;
    });
    const deps = trackBootstrapDeps({
      ...baseBootstrapDeps(),
      drainScheduler: async () => drainGate,
    });
    await bootstrapServer(deps);

    const shutdownDone = deps.shutdownHandlers[0]!();
    await Promise.resolve();
    expect(deps.calls).not.toContain("closeDb");
    expect(deps.calls).not.toContain("exitProcess:0");

    releaseDrain();
    await shutdownDone;
    expect(deps.calls).toContain("closeDb");
    expect(deps.calls).toContain("exitProcess:0");
  });

  test("shutdown is idempotent across repeated signals", async () => {
    const deps = trackBootstrapDeps(baseBootstrapDeps());
    await bootstrapServer(deps);

    const handler = deps.shutdownHandlers[0]!;
    await Promise.all([handler(), handler()]);
    await handler();

    expect(deps.calls.filter((c) => c === "closeDb")).toHaveLength(1);
    expect(deps.calls.filter((c) => c === "exitProcess:0")).toHaveLength(1);
    expect(deps.calls.filter((c) => c === "stopScheduler")).toHaveLength(1);
  });

  test("shutdown proceeds to close db when stopping the http server fails", async () => {
    const deps = trackBootstrapDeps({
      ...baseBootstrapDeps(),
      startHttpServer: () => ({
        stop: () => {
          throw new Error("listener already gone");
        },
      }),
    });
    await bootstrapServer(deps);

    await deps.shutdownHandlers[0]!();

    expect(deps.calls).toContain("closeDb");
    expect(deps.calls).toContain("exitProcess:0");
  });

  test("skips createModel when config has no llm block", async () => {
    const deps = trackBootstrapDeps(baseBootstrapDeps());
    await bootstrapServer(deps);
    expect(deps.calls).not.toContain("createModel");
  });

  test("creates llm model when config includes llm", async () => {
    const base = baseBootstrapDeps();
    const deps = trackBootstrapDeps({
      ...base,
      loadConfig: () =>
        testAppConfig(
          {
            adapters: [],
            llm: { provider: "openai", model: "gpt-4o-mini" },
          },
          singlePanelLayout("Tech", "hackernews"),
        ),
      createModel: (cfg) => {
        expect(cfg.model).toBe("gpt-4o-mini");
        return null;
      },
    });

    await bootstrapServer(deps);
    expect(deps.calls).toContain("createModel");
  });

  test("passes layout maps and refreshSources into createServerApp", async () => {
    const config = testAppConfig(
      { adapters: [{ type: "hackernews", refresh_interval: 15 }] },
      singlePanelLayout("Tech", "hackernews", { id: "tech-panel" }),
    );
    const refreshSources = async () => [];
    let routeDeps: Parameters<BootstrapServerDeps["createServerApp"]>[0] | undefined;

    const deps = trackBootstrapDeps({
      ...baseBootstrapDeps(),
      loadConfig: () => config,
      refreshSources,
      createServerApp: (depsArg) => {
        routeDeps = depsArg;
        return new Hono();
      },
    });

    await bootstrapServer(deps);

    expect(routeDeps?.layout).toBe(config.layout);
    expect(routeDeps?.dashboardPanels).toHaveLength(1);
    expect(routeDeps?.panelNameToId.get("Tech")).toBe("tech-panel");
    expect(routeDeps?.panelIdToRefreshSourceNames.get("tech-panel")).toEqual(["hackernews"]);
    expect(routeDeps?.refreshSources).toBe(deps.refreshSources);
  });

  test("wires scheduler panel map from layout runtime maps", async () => {
    const base = baseBootstrapDeps();
    let panelMap: unknown;
    const deps = trackBootstrapDeps({
      ...base,
      loadConfig: () =>
        testAppConfig({ adapters: [{ type: "reddit", refresh_interval: 10 }] }, {
          direction: "row",
          panels: [{ panel: "Feed", source: "reddit", id: "feed-panel" }],
        }),
      startScheduler: (_config, _adapters, map) => {
        panelMap = map;
      },
      createServerApp: () => new Hono(),
    });

    await bootstrapServer(deps);

    expect(panelMap).toEqual({
      sourceToPanels: new Map([["reddit", ["feed-panel"]]]),
      sourceToReadKey: new Map([["reddit", "feed-panel"]]),
    });
  });
});