#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import { errorMessage, parseCliPort } from "./utils";
import { tryReadRegularFile } from "./config";
import {
  cliDie,
  cliExitOk,
  cliFailWithHelp,
  formatCliHelp,
  isCliFatalStartupError,
  isCliKnownOption,
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

if (values["list-presets"] !== undefined) values.listPresets = values["list-presets"];

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
  const { listPresets } = await import("./config");
  cliExitOk(listPresets().join("\n"));
}

if (values.preset && !values.config) {
  const { resolvePreset, listPresets } = await import("./config");
  const resolved = resolvePreset(values.preset);
  if (resolved) {
    process.env.PACE_CONFIG = resolved;
  } else {
    cliDie(`Unknown preset: ${values.preset}\nAvailable: ${listPresets().join(", ")}`);
  }
}

const command = positionals[0] ?? "serve";

if (command !== "serve") {
  cliFailWithHelp(`Unknown command: ${command}\n`, HELP);
}

const unexpected = Object.keys(values).filter((k) => !isCliKnownOption(k) && values[k] !== undefined);
if (unexpected.length > 0) {
  cliFailWithHelp(`Unknown option(s): ${unexpected.map((u) => "--" + u).join(", ")}\n`, HELP);
}

if (values.config) {
  const configPath = values.config;
  try {
    tryReadRegularFile(configPath);
  } catch (err) {
    cliDie(errorMessage(err));
  }
  process.env.PACE_CONFIG = configPath;
}

if (values.port) {
  const p = values.port;
  const n = parseCliPort(p);
  if (n === null) {
    cliDie(`Invalid --port value: ${p}. Must be an integer between 1 and 65535.`);
  }
  process.env.PORT = String(n);
}

try {
  await import("./index");
} catch (err) {
  const message = errorMessage(err);
  if (isCliFatalStartupError(message)) {
    cliDie(message);
  }
  throw err;
}
