import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawn, type ChildProcess } from "node:child_process";
import { runCli } from "./test/cli-runner";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  applyCliConfigEnv,
  applyCliPortEnv,
  cliHelpStdout,
  formatCliHelp,
  isCliFatalStartupError,
  normalizeCliParsedValues,
  resolveCliInfoOutput,
  resolveCliServeErrors,
} from "./cli-help";

describe("cli-help", () => {
  test("isCliFatalStartupError matches config/scheduler/index prefixes", () => {
    expect(isCliFatalStartupError("config: bad yaml")).toBe(true);
    expect(isCliFatalStartupError("scheduler: boom")).toBe(true);
    expect(isCliFatalStartupError("index: failed to read styles.css")).toBe(true);
    expect(isCliFatalStartupError("cli: failed to chdir")).toBe(false);
    expect(isCliFatalStartupError("unexpected")).toBe(false);
  });

  test("normalizeCliParsedValues maps list-presets to listPresets", () => {
    const values = { "list-presets": true } as Record<string, unknown>;
    normalizeCliParsedValues(values);
    expect(values.listPresets).toBe(true);
  });

  test("normalizeCliParsedValues coerces non-boolean list-presets to false", () => {
    const values = { "list-presets": "true" } as Record<string, unknown>;
    normalizeCliParsedValues(values);
    expect(values.listPresets).toBe(false);
  });

  test("applyCliConfigEnv sets PACE_CONFIG from preset and validates explicit config", () => {
    const orig = process.env.PACE_CONFIG;
    try {
      applyCliConfigEnv(
        { preset: "tech-news" },
        {
          resolvePreset: (name) => (name === "tech-news" ? "/presets/tech-news.yaml" : null),
          listPresets: () => ["tech-news"],
          tryReadRegularFile: () => "ok",
        },
      );
      expect(process.env.PACE_CONFIG).toBe("/presets/tech-news.yaml");

      applyCliConfigEnv(
        { config: "/tmp/my.yaml" },
        {
          resolvePreset: () => null,
          listPresets: () => [],
          tryReadRegularFile: (path) => {
            if (path === "/tmp/my.yaml") return "yaml";
            throw new Error(`config: ${path} is not a regular file`);
          },
        },
      );
      expect(process.env.PACE_CONFIG).toBe("/tmp/my.yaml");

      let missingExit: number | undefined;
      let missingStderr = "";
      const origExit = process.exit;
      const origError = console.error;
      try {
        process.exit = ((code?: number) => {
          missingExit = code ?? 0;
          throw new Error("cliDie");
        }) as typeof process.exit;
        console.error = (msg: string) => {
          missingStderr = String(msg);
        };
        expect(() =>
          applyCliConfigEnv(
            { config: "/tmp/missing.yaml" },
            {
              resolvePreset: () => null,
              listPresets: () => [],
              tryReadRegularFile: () => null,
            },
          ),
        ).toThrow("cliDie");
        expect(missingExit).toBe(1);
        expect(missingStderr).toBe("config: file not found: /tmp/missing.yaml");
      } finally {
        process.exit = origExit;
        console.error = origError;
      }
    } finally {
      if (orig === undefined) delete process.env.PACE_CONFIG;
      else process.env.PACE_CONFIG = orig;
    }
  });

  test("resolveCliInfoOutput dispatches help, version, and list-presets", () => {
    const ctx = {
      version: "9.9.9",
      help: "HELP TEXT",
      listPresets: () => ["alpha", "beta"],
    };
    expect(resolveCliInfoOutput({ help: true }, ctx)).toBe("HELP TEXT");
    expect(resolveCliInfoOutput({ version: true }, ctx)).toBe("9.9.9");
    expect(resolveCliInfoOutput({ listPresets: true }, ctx)).toBe("alpha\nbeta");
    expect(resolveCliInfoOutput({}, ctx)).toBeNull();
  });

  test("cliHelpStdout matches formatCliHelp plus console.log newline", () => {
    expect(cliHelpStdout("1.2.3")).toBe(formatCliHelp("1.2.3") + "\n");
  });

  test("resolveCliServeErrors rejects unknown commands and options", () => {
    expect(resolveCliServeErrors({}, undefined)).toBeNull();
    expect(resolveCliServeErrors({}, "serve")).toBeNull();

    expect(resolveCliServeErrors({}, "foo")).toEqual({
      stderr: "Unknown command: foo\n",
      showHelp: true,
    });
    expect(resolveCliServeErrors({ badflag: true, prt: true }, "serve")).toEqual({
      stderr: "Unknown option(s): --badflag, --prt\n",
      showHelp: true,
    });
    expect(resolveCliServeErrors({ help: true }, "serve")).toBeNull();
  });

  test("applyCliPortEnv sets PORT for valid values and no-ops when unset", () => {
    const orig = process.env.PORT;
    try {
      delete process.env.PORT;
      applyCliPortEnv(undefined);
      expect(process.env.PORT).toBeUndefined();

      applyCliPortEnv("8080");
      expect(process.env.PORT).toBe("8080");
    } finally {
      if (orig === undefined) delete process.env.PORT;
      else process.env.PORT = orig;
    }
  });
});

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
    const help = cliHelpStdout();
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
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("unknown options rejected with HELP", () => {
    const res = runCli(["--badflag", "--prt"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s): --badflag, --prt");
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("invalid --port rejected", () => {
    const res = runCli(["--port", "99999"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: invalid --port value "99999"');
    expect(res.stdout).toBe("");
  });

  test("partial numeric --port rejected (no parseInt prefix acceptance)", () => {
    const res = runCli(["--port", "8080abc"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: invalid --port value "8080abc"');
    expect(res.stdout).toBe("");
  });

  test("--config non-regular file rejected", () => {
    const res = runCli(["--config", tmpDir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`config: ${tmpDir} is not a regular file`);
    expect(res.stdout).toBe("");
  });

  test("--config missing file rejected at CLI validation", () => {
    const missing = join(tmpDir, "does-not-exist.yaml");
    const res = runCli(["--config", missing]);
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toBe(`config: file not found: ${missing}`);
    expect(res.stdout).toBe("");
  });

  test("unknown --preset lists available presets", () => {
    const res = runCli(["--preset", "not-a-real-preset"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: unknown preset "not-a-real-preset"');
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
    expect(resValidThenPort.stderr).toContain('cli: invalid --port value "99999"');
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
    let serverLog = "";
    const proc: ChildProcess = spawn(process.execPath, ["src/cli.ts", "--port", String(port), "--preset", "tech-news", "serve"], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env,
    });
    const appendLog = (d: Buffer) => { serverLog += d.toString(); };
    proc.stdout?.on("data", appendLog);
    proc.stderr?.on("data", appendLog);
    const base = `http://localhost:${port}`;
    async function waitForServerReady(deadlineMs: number): Promise<void> {
      const start = Date.now();
      while (Date.now() - start < deadlineMs) {
        if (proc.exitCode !== null) {
          throw new Error(
            `server exited with code ${proc.exitCode} before ready:\n${serverLog}`,
          );
        }
        try {
          const signal =
            typeof AbortSignal.timeout === "function"
              ? AbortSignal.timeout(800)
              : undefined;
          const r = await fetch(`${base}/health`, { signal });
          if (r.status === 200) return;
        } catch {
          // not listening yet
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`server not ready after ${deadlineMs}ms:\n${serverLog}`);
    }
    await waitForServerReady(12_000);
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
