import { spawn, type ChildProcess } from "node:child_process";
import { responseHeadersToLowercase } from "./server-harness";

export type CliServeHarness = {
  proc: ChildProcess;
  base: string;
  port: number;
  serverLog: string;
  dbPath: string;
};

export type SpawnCliServeServerOptions = {
  port?: number;
  preset?: string;
  dbPath?: string;
  extraEnv?: Record<string, string | undefined>;
};

/** Spawn `pace serve` as a live child process for integration tests. */
export function spawnCliServeServer(
  options: SpawnCliServeServerOptions = {},
): CliServeHarness {
  const port = options.port ?? 18476 + (process.pid % 200);
  const dbPath = options.dbPath ?? `/tmp/pace-cli-serve-test-${port}.db`;
  const preset = options.preset ?? "tech-news";
  const env = {
    ...process.env,
    PACE_DB_PATH: dbPath,
    ...options.extraEnv,
  };
  const proc = spawn(
    process.execPath,
    ["src/cli.ts", "--port", String(port), "--preset", preset, "serve"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env,
    },
  );
  const harness: CliServeHarness = {
    proc,
    base: `http://localhost:${port}`,
    port,
    serverLog: "",
    dbPath,
  };
  const appendLog = (chunk: Buffer) => {
    harness.serverLog += chunk.toString();
  };
  proc.stdout?.on("data", appendLog);
  proc.stderr?.on("data", appendLog);
  return harness;
}

/** Build an absolute URL for a live CLI server route. */
export function cliServeUrl(harness: CliServeHarness, path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${harness.base}${normalized}`;
}

/** Poll /health until the live CLI server responds or the process exits. */
export async function waitForCliServeReady(
  harness: CliServeHarness,
  deadlineMs = 12_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    if (harness.proc.exitCode !== null) {
      throw new Error(
        `server exited with code ${harness.proc.exitCode} before ready:\n${harness.serverLog}`,
      );
    }
    try {
      const health = await requestCliServeHealth(harness, { signal: cliServeRequestSignal(800) });
      if (health.status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`server not ready after ${deadlineMs}ms:\n${harness.serverLog}`);
}

export function cliServeRequestSignal(timeoutMs = 2500): AbortSignal | undefined {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export type CliServeResponse = {
  status: number;
  hd: Record<string, string>;
  body: unknown;
};

/** POST /refresh/:panelParam against a live CLI server (redirect: manual). */
export async function requestCliServeRefresh(
  harness: CliServeHarness,
  panelParam: string,
  options?: { signal?: AbortSignal },
): Promise<Response> {
  return fetch(cliServeUrl(harness, `/refresh/${panelParam}`), {
    method: "POST",
    redirect: "manual",
    signal: options?.signal ?? cliServeRequestSignal(),
  });
}

async function parseCliServeResponse(response: Response): Promise<CliServeResponse> {
  const hd = responseHeadersToLowercase(response);
  const contentType = hd["content-type"] || "";
  let body: unknown = "";
  try {
    if (contentType.includes("json")) body = await response.json();
    else body = await response.text();
  } catch {
    body = "";
  }
  return { status: response.status, hd, body };
}

/** Issue an HTTP request against a live CLI server with parsed headers/body. */
export async function requestCliServe(
  url: string,
  method = "GET",
  options?: { signal?: AbortSignal },
): Promise<CliServeResponse> {
  const response = await fetch(url, {
    method,
    signal: options?.signal ?? cliServeRequestSignal(),
  });
  return parseCliServeResponse(response);
}

/** GET / against a live CLI server. */
export async function requestCliServeDashboard(
  harness: CliServeHarness,
  options?: { signal?: AbortSignal },
): Promise<CliServeResponse> {
  return requestCliServe(cliServeUrl(harness, "/"), "GET", options);
}

/** GET /health against a live CLI server. */
export async function requestCliServeHealth(
  harness: CliServeHarness,
  options?: { signal?: AbortSignal },
): Promise<CliServeResponse> {
  return requestCliServe(cliServeUrl(harness, "/health"), "GET", options);
}

/** GET /styles.css against a live CLI server. */
export async function requestCliServeStyles(
  harness: CliServeHarness,
  options?: { signal?: AbortSignal },
): Promise<CliServeResponse> {
  return requestCliServe(cliServeUrl(harness, "/styles.css"), "GET", options);
}

/** Stop a live CLI server child process started by spawnCliServeServer. */
export async function killCliServeServer(harness: CliServeHarness): Promise<void> {
  if (harness.proc.pid) {
    try {
      process.kill(harness.proc.pid, "SIGKILL");
    } catch {
      // already exited
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
}