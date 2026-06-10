import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { buildLayoutRuntimeMaps, type Adapter } from "../layout/types";
import { singlePanelLayout, testAppConfig } from "../test/app-config";
import { bootstrapServer, type BootstrapServerDeps } from "./bootstrap";

type TrackedBootstrapDeps = BootstrapServerDeps & {
  calls: string[];
  shutdownHandlers: Array<() => void>;
  served: { port: number; fetch: (req: Request) => Response | Promise<Response> } | null;
};

function trackBootstrapDeps(deps: BootstrapServerDeps): TrackedBootstrapDeps {
  const calls: string[] = [];
  const shutdownHandlers: Array<() => void> = [];
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
      deps.startHttpServer(port, fetch);
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
    refreshSources: async () => [],
    createServerApp: () => new Hono(),
    resolvePort: () => 8123,
    registerShutdown: () => {},
    startHttpServer: () => {},
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

    deps.shutdownHandlers[0]!();

    expect(deps.calls).toContain("stopScheduler");
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