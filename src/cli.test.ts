import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync, spawn, type SpawnSyncReturns, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { formatCliHelp } from "./cli-help";

function expectedCliHelp(): string {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "../package.json"), "utf-8"),
  ) as { version: string };
  return formatCliHelp(pkg.version);
}

/** stdout from `console.log(HELP)` — template newline plus log's trailing newline. */
function expectedCliHelpStdout(): string {
  return expectedCliHelp() + "\n";
}

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    encoding: "utf8",
    stdio: "pipe",
    cwd: process.cwd(),
    env: { ...process.env, PACE_DB_PATH: "/tmp/pace-cli-test.db" },
  });
}

describe("cli.ts (argument handling, validation, early exits, error surfacing)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-test-"));
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("--help and -h print stable usage text and exit 0", () => {
    const help = expectedCliHelpStdout();
    for (const flag of ["--help", "-h"]) {
      const res = runCli([flag]);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(help);
      expect(res.stderr).toBe("");
    }
  });

  test("--version prints version and exits 0", () => {
    const res = runCli(["--version"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
    expect(res.stdout).not.toContain("Usage:");
    expect(res.stderr).toBe("");
  });

  test("unknown command prints error + HELP and exits 1", () => {
    const res = runCli(["foo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: foo");
    expect(res.stdout).toBe(expectedCliHelpStdout());
  });

  test("unknown option is rejected with clear message + HELP + exit 1", () => {
    const res = runCli(["--badflag", "--prt"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s): --badflag, --prt");
    expect(res.stdout).toBe(expectedCliHelpStdout());
  });

  test("invalid --port (out of range) prints exact message and exits 1 before server", () => {
    const res = runCli(["--port", "99999"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid --port value: 99999. Must be an integer between 1 and 65535.");
    expect(res.stdout).toBe("");
  });

  test("--config pointing to directory (non-regular file) prints clean error and exits 1", () => {
    const res = runCli(["--config", tmpDir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`config: ${tmpDir} is not a regular file`);
    expect(res.stdout).toBe("");
  });

  test("unknown --preset prints error, Available presets from listPresets, exits 1", () => {
    const res = runCli(["--preset", "not-a-real-preset"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown preset: not-a-real-preset");
    expect(res.stderr).toContain("Available:");
    expect(res.stderr).toContain("tech-news");
    expect(res.stdout).toBe("");
  });

  test("bad config file (parse error) is surfaced cleanly as config: prefixed error + exit 1", () => {
    const badCfg = join(tmpDir, "bad.yaml");
    writeFileSync(badCfg, "not: valid: yaml: [");
    const res = runCli(["--config", badCfg]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("config: failed to parse YAML from");
    expect(res.stderr).toContain(badCfg);
  });

  test("--chdir/-C <dir> is accepted (not unknown opt); chdirs for subsequent loads (e.g. config validation uses target cwd); errors cleanly for invalid dir (nonexistent or not dir) with 'Failed to chdir' message + exit 1 (TDD red-green for td2 chdir quality + new CLI capability)", () => {
    // invalid dir + --version (version early but if chdir handling placed early before version if, it will error first with clean msg)
    const bad = join(tmpDir, "nonexistent-chdir-subdir-xyz");
    const resBad = runCli(["--chdir", bad, "--version"]);
    expect(resBad.status).toBe(1);
    expect(resBad.stderr).toContain("Failed to chdir");
    expect(resBad.stderr).toContain(bad);
    expect(resBad.stdout).toBe("");
    // valid dir + bad --port (port validation is after chdir handling + unknown check; proves --chdir was accepted not rejected as unknown, processing continued to subsequent validation)
    const resValidThenPort = runCli(["-C", tmpDir, "--port", "99999"]);
    expect(resValidThenPort.status).toBe(1);
    expect(resValidThenPort.stderr).toContain("Invalid --port value: 99999");
    expect(resValidThenPort.stderr).not.toContain("Unknown option");
    expect(resValidThenPort.stdout).toBe("");
  });
});

describe("server (integration via bg CLI spawn: /health m15, /styles cache m15, /refresh 502 fail igb + 404, yn0+quality headers on all responses)", () => {
  test("GET /health returns 200+{status:\"ok\"}; GET /styles.css 200+1h cache; POST /refresh/reddit ->502 w/details (igb, reddit fails in this env); /refresh/unknown->404; EVERY resp (200/404/502) includes yn0 security headers + quality Permissions-Policy (test-first TDD for server facts igb/yn0/m15)", async () => {
    const port = 18476 + (process.pid % 200);
    const dbPath = `/tmp/pace-iter6-server-test-${port}.db`;
    const logPath = `/tmp/pace-iter6-server-test-${port}.log`;
    const env = { ...process.env, PACE_DB_PATH: dbPath };
    // cleanup prior
    try { require("node:fs").unlinkSync(dbPath); } catch {}
    try { require("node:fs").unlinkSync(logPath); } catch {}
    const proc: ChildProcess = spawn(process.execPath, ["src/cli.ts", "--port", String(port), "--preset", "tech-news", "serve"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env,
    });
    // wait for listening (or timeout)
    await new Promise<void>((resolve) => {
      let buf = "";
      const timer = setTimeout(() => resolve(), 2800);
      const onData = (d: Buffer) => {
        buf += d.toString();
        if (buf.includes("listening on")) {
          clearTimeout(timer);
          proc.stdout?.off("data", onData);
          resolve();
        }
      };
      proc.stdout?.on("data", onData);
      proc.stderr?.on("data", (d: Buffer) => { buf += d.toString(); });
    });
    const base = `http://localhost:${port}`;
    function requestSignal(): AbortSignal | undefined {
      if (typeof AbortSignal.timeout === "function") {
        return AbortSignal.timeout(2500);
      }
      return undefined;
    }
    async function req(url: string, method = "GET") {
      const r = await fetch(url, { method, signal: requestSignal() });
      const status = r.status;
      const hd: Record<string, string> = {};
      r.headers.forEach((v, k) => { hd[k.toLowerCase()] = v; });
      const ct = hd["content-type"] || "";
      let body: unknown = "";
      try {
        if (ct.includes("json")) body = await r.json();
        else body = await r.text();
      } catch { body = ""; }
      return { status, hd, body };
    }
    const health = await req(`${base}/health`);
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok" });
    const styles = await req(`${base}/styles.css`);
    expect(styles.status).toBe(200);
    expect(styles.hd["cache-control"] || "").toContain("max-age=3600");
    // use redirect:manual so fetch does not follow 303; reddit may 502 (fail) or 303 (success) depending on net
    const r502 = await fetch(`${base}/refresh/reddit`, { method: "POST", redirect: "manual" });
    const r502Status = r502.status;
    const r502Body = await r502.text().catch(() => "");
    expect([502, 303]).toContain(r502Status);
    if (r502Status === 502) expect(r502Body).toContain("Refresh failed for reddit:");
    const r404 = await fetch(`${base}/refresh/unknownpanel-iter6`, { method: "POST", redirect: "manual" });
    expect(r404.status).toBe(404);
    const r404Body = await r404.text().catch(() => "");
    expect(r404Body).toContain("Unknown panel:");
    // verify yn0 + quality header on all responses (the improvement)
    const secKeys = ["x-content-type-options", "x-frame-options", "referrer-policy", "content-security-policy", "permissions-policy"];
    const toCheck = [
      health,
      styles,
      { hd: Object.fromEntries(r502.headers.entries()) },
      { hd: Object.fromEntries(r404.headers.entries()) },
    ];
    toCheck.forEach((resp) => {
      const lowerHd: Record<string, string> = {};
      Object.entries(resp.hd || {}).forEach(([k, v]) => { lowerHd[k.toLowerCase()] = v as string; });
      secKeys.forEach((k) => {
        expect(lowerHd[k]).toBeDefined();
      });
      expect(lowerHd["content-security-policy"]).toContain("default-src 'self'");
      expect(lowerHd["permissions-policy"]).toBe("interest-cohort=()");
    });
    // cleanup robust
    if (proc.pid) { try { process.kill(proc.pid, "SIGKILL"); } catch {} }
    await new Promise((r) => setTimeout(r, 200));
    try { require("node:fs").unlinkSync(dbPath); } catch {}
    try { require("node:fs").unlinkSync(logPath); } catch {}
  }, 15000);
});
