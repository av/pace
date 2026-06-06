import { spawnSync, type SpawnSyncReturns } from "node:child_process";

/** Run src/cli.ts synchronously with isolated test DB path. */
export function runCli(args: string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["src/cli.ts", ...args], {
    encoding: "utf8",
    stdio: "pipe",
    cwd: process.cwd(),
    env: { ...process.env, PACE_DB_PATH: "/tmp/pace-cli-test.db" },
  });
}