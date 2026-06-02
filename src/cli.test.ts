import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync, spawn, type SpawnSyncReturns, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { formatCliHelpStdout } from "./cli-help";

function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    encoding: "utf8",
    stdio: "pipe",
    cwd: process.cwd(),
    env: { ...process.env, PACE_DB_PATH: "/tmp/pace-cli-test.db" },
  });
}

describe("cli", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-test-"));
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("--help/-h prints usage", () => {
    const help = formatCliHelpStdout();
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

  test("unknown command prints HELP", () => {
    const res = runCli(["foo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: foo");
    expect(res.stdout).toBe(formatCliHelpStdout());
  });

  test("unknown options rejected with HELP", () => {
    const res = runCli(["--badflag", "--prt"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s): --badflag, --prt");
    expect(res.stdout).toBe(formatCliHelpStdout());
  });

  test("invalid --port rejected", () => {
    const res = runCli(["--port", "99999"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid --port value: 99999. Must be an integer between 1 and 65535.");
    expect(res.stdout).toBe("");
  });

  test("--config non-regular file rejected", () => {
    const res = runCli(["--config", tmpDir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`config: ${tmpDir} is not a regular file`);
    expect(res.stdout).toBe("");
  });

  test("unknown --preset lists available presets", () => {
    const res = runCli(["--preset", "not-a-real-preset"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown preset: not-a-real-preset");
    expect(res.stderr).toContain("Available:");
    expect(res.stderr).toContain("tech-news");
    expect(res.stdout).toBe("");
  });

  test("bad YAML config surfaces config: error", () => {
    const badCfg = join(tmpDir, "bad.yaml");
    writeFileSync(badCfg, "not: valid: yaml: [");
    const res = runCli(["--config", badCfg]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("config: failed to parse YAML from");
    expect(res.stderr).toContain(badCfg);
  });

  test("--chdir/-C accepted; invalid dir fails with cli: chdir message", () => {
    const bad = join(tmpDir, "nonexistent-chdir-subdir-xyz");
    const resBad = runCli(["--chdir", bad, "--version"]);
    expect(resBad.status).toBe(1);
    expect(resBad.stderr).toContain(`cli: failed to chdir to ${bad}:`);
    expect(resBad.stderr).toContain(bad);
    expect(resBad.stdout).toBe("");
    const resValidThenPort = runCli(["-C", tmpDir, "--port", "99999"]);
    expect(resValidThenPort.status).toBe(1);
    expect(resValidThenPort.stderr).toContain("Invalid --port value: 99999");
    expect(resValidThenPort.stderr).not.toContain("Unknown option");
    expect(resValidThenPort.stdout).toBe("");
  });
});

describe("cli serve", () => {
  test("health, styles cache, refresh errors, security headers", async () => {
    const port = 18476 + (process.pid % 200);
    const dbPath = `/tmp/pace-iter6-server-test-${port}.db`;
    const logPath = `/tmp/pace-iter6-server-test-${port}.log`;
    const env = { ...process.env, PACE_DB_PATH: dbPath };
    try { require("node:fs").unlinkSync(dbPath); } catch {}
    try { require("node:fs").unlinkSync(logPath); } catch {}
    const proc: ChildProcess = spawn(process.execPath, ["src/cli.ts", "--port", String(port), "--preset", "tech-news", "serve"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env,
    });
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
    const r502 = await fetch(`${base}/refresh/reddit`, { method: "POST", redirect: "manual" });
    const r502Status = r502.status;
    const r502Body = await r502.text().catch(() => "");
    expect([502, 303]).toContain(r502Status);
    if (r502Status === 502) expect(r502Body).toContain("Refresh failed for reddit:");
    const r404 = await fetch(`${base}/refresh/unknownpanel-iter6`, { method: "POST", redirect: "manual" });
    expect(r404.status).toBe(404);
    const r404Body = await r404.text().catch(() => "");
    expect(r404Body).toContain("Unknown panel:");
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
    if (proc.pid) { try { process.kill(proc.pid, "SIGKILL"); } catch {} }
    await new Promise((r) => setTimeout(r, 200));
    try { require("node:fs").unlinkSync(dbPath); } catch {}
    try { require("node:fs").unlinkSync(logPath); } catch {}
  }, 15000);
});
