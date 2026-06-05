#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import { errorMessage } from "./utils";
import { listPresets, resolvePreset, tryReadRegularFile } from "./config";
import {
  applyCliConfigEnv,
  applyCliPortEnv,
  cliDie,
  cliExitOk,
  cliFailWithHelp,
  formatCliHelp,
  isCliFatalStartupError,
  isCliKnownOption,
  normalizeCliParsedValues,
  readPackageVersion,
} from "./cli-help";

const version = readPackageVersion();

const projectRoot = join(import.meta.dir, "..");
process.chdir(projectRoot);

const HELP = formatCliHelp(version);

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    port: { type: "string", short: "p" },
    chdir: { type: "string", short: "C" },
    preset: { type: "string", short: "P" },
    listPresets: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
  strict: false,
});

normalizeCliParsedValues(values);

if (values.chdir) {
  const target = values.chdir;
  try {
    process.chdir(target);
  } catch (err) {
    cliDie(`cli: failed to chdir to ${target}: ${errorMessage(err)}`);
  }
}

if (values.help) {
  cliExitOk(HELP);
}

if (values.version) {
  cliExitOk(version);
}

if (values.listPresets) {
  cliExitOk(listPresets().join("\n"));
}

const command = positionals[0] ?? "serve";

if (command !== "serve") {
  cliFailWithHelp(`Unknown command: ${command}\n`, HELP);
}

const unexpected = Object.keys(values).filter((k) => !isCliKnownOption(k) && values[k] !== undefined);
if (unexpected.length > 0) {
  cliFailWithHelp(`Unknown option(s): ${unexpected.map((u) => "--" + u).join(", ")}\n`, HELP);
}

applyCliConfigEnv(values, { resolvePreset, listPresets, tryReadRegularFile });
applyCliPortEnv(values.port);

try {
  await import("./index");
} catch (err) {
  const message = errorMessage(err);
  if (isCliFatalStartupError(message)) {
    cliDie(message);
  }
  throw err;
}
