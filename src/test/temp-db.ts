import { beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeDb, initDb } from "../db";
import { errorMessage } from "../utils";

type TempDbFixture = {
  tempDir: string;
  dbPath: string;
};

type InstallTempDbHooksOptions = {
  /** mkdtemp prefix, e.g. "pace-dbtest-" */
  prefix: string;
  /** Call initDb() after closeDb in beforeEach (default: true) */
  init?: boolean;
  /** Log and swallow rmSync failures instead of rethrowing (default: false) */
  warnOnRmFail?: boolean;
};

let fixture: TempDbFixture;
let origEnv: string | undefined;

/** Install isolated PACE_DB_PATH beforeEach/afterEach hooks for integration tests. */
export function installTempDbHooks(options: InstallTempDbHooksOptions): void {
  const {
    prefix,
    init = true,
    warnOnRmFail = false,
  } = options;

  beforeEach(() => {
    origEnv = process.env.PACE_DB_PATH;
    const tempDir = mkdtempSync(join(tmpdir(), prefix));
    const dbPath = join(tempDir, "test.db");
    fixture = { tempDir, dbPath };
    process.env.PACE_DB_PATH = dbPath;
    closeDb();
    if (init) initDb();
  });

  afterEach(() => {
    closeDb();
    if (origEnv === undefined) {
      delete process.env.PACE_DB_PATH;
    } else {
      process.env.PACE_DB_PATH = origEnv;
    }
    try {
      rmSync(fixture.tempDir, { recursive: true, force: true });
    } catch (err) {
      if (warnOnRmFail) {
        console.warn(`temp-db: failed to remove ${fixture.tempDir}: ${errorMessage(err)}`);
      } else {
        throw err;
      }
    }
  });
}

/** Current per-test temp DB paths (valid inside tests after beforeEach). */
export function tempDbFixture(): TempDbFixture {
  return fixture;
}