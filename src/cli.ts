#!/usr/bin/env bun
import { join } from "node:path";
import { parseArgs } from "node:util";
import { errorMessage, isValidPort } from "./utils";
import { tryReadRegularFile } from "./config";
import { formatCliHelp, isCliKnownOption, readPackageVersion } from "./cli-help";

const version = readPackageVersion();

function cliDie(message: string): never {
  console.error(message);
  process.exit(1);
}

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
  console.log(HELP);
  process.exit(0);
}

if (values.version) {
  console.log(version);
  process.exit(0);
}

if (values.listPresets) {
  const { listPresets } = await import("./config");
  console.log(listPresets().join("\n"));
  process.exit(0);
}

if (values.preset && !values.config) {
  const { resolvePreset, listPresets } = await import("./config");
  const resolved = resolvePreset(values.preset);
  if (resolved) {
    process.env.PACE_CONFIG = resolved;
  } else {
    console.error(`Unknown preset: ${values.preset}`);
    console.error(`Available: ${listPresets().join(", ")}`);
    process.exit(1);
  }
}

const command = positionals[0] ?? "serve";

if (command !== "serve") {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

const unexpected = Object.keys(values).filter((k) => !isCliKnownOption(k) && values[k] !== undefined);
if (unexpected.length > 0) {
  console.error(`Unknown option(s): ${unexpected.map((u) => "--" + u).join(", ")}\n`);
  console.log(HELP);
  process.exit(1);
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
  const n = parseInt(p, 10);
  if (!isValidPort(n)) {
    console.error(`Invalid --port value: ${p}. Must be an integer between 1 and 65535.`);
    process.exit(1);
  }
  process.env.PORT = p;
}

try {
  await import("./index");
} catch (err) {
  const message = errorMessage(err);
  if (message.startsWith("config:") || message.startsWith("scheduler:")) {
    cliDie(message);
  }
  throw err;
}
