import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

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

  test("--help prints usage and exits 0 without side effects", () => {
    const res = runCli(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("pace v");
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("--config");
    expect(res.stdout).toContain("--port");
    expect(res.stderr).toBe("");
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
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("--config");
  });

  test("unknown option is rejected with clear message + HELP + exit 1", () => {
    const res = runCli(["--badflag", "--prt"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s): --badflag, --prt");
    expect(res.stdout).toContain("Usage:");
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

  test("bad config file (parse error) is surfaced cleanly as config: prefixed error + exit 1", () => {
    const badCfg = join(tmpDir, "bad.yaml");
    writeFileSync(badCfg, "not: valid: yaml: [");
    const res = runCli(["--config", badCfg]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("config: failed to parse YAML from");
    expect(res.stderr).toContain(badCfg);
  });
});
