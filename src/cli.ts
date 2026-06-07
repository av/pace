#!/usr/bin/env bun
import { join } from "node:path";
import { listPresets, resolvePreset, tryReadRegularFile } from "./config";
import { runCli } from "./cli-help";

process.chdir(join(import.meta.dir, ".."));

await runCli(Bun.argv.slice(2), {
  resolvePreset,
  listPresets,
  tryReadRegularFile,
});