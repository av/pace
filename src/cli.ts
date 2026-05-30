#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { errorMessage, isValidPort } from "./adapters/types";
import { tryReadRegularFile } from "./config";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf-8"));

// Ensure we always run from the project root containing this package.json (and tsconfig.json,
// node_modules, default config.yaml, data/). This makes the CLI (and global `pace` via bun link)
// robust to any shell cwd, fixes tsx/jsx resolution, and ensures defaults are project-local.
const projectRoot = join(import.meta.dir, "..");
process.chdir(projectRoot); // projectRoot chdir (ensures cwd for tsconfig + defaults)

const HELP = `pace v${pkg.version} — personal content dashboard

Usage:
  pace [command] [options]

Commands:
  serve     Start the dashboard server (default)

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -p, --port <number>   Server port (default: 7453, or $PORT)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
      --list-presets    List available bundled presets
  -h, --help            Show this help
  -v, --version         Show version
`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    port: { type: "string", short: "p" },
    preset: { type: "string", short: "P" },
    listPresets: { type: "boolean" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
  strict: false,
});

// parseArgs keeps kebab-case for some flags (e.g. --list-presets -> "list-presets")
if (values['list-presets'] !== undefined) values.listPresets = values['list-presets'];

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

if (values.listPresets) {
  const { listPresets } = await import("./config");
  console.log(listPresets().join("\n"));
  process.exit(0);
}

if (values.preset && !values.config) {
  const { resolvePreset } = await import("./config");
  const resolved = resolvePreset(values.preset);
  if (resolved) {
    process.env.PACE_CONFIG = resolved;
  } else {
    console.error(`Unknown preset: ${values.preset}`);
    console.error(`Available: ${["example","tech-news","ml-ai","product-launches","release-tracker","academic-papers","video-podcast"].join(", ")}`);
    process.exit(1);
  }
}

const command = positionals[0] ?? "serve";

if (command !== "serve") {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

// Reject unknown options (parseArgs with strict:false still populates undeclared keys into values,
// e.g. --badflag or typos). This provides clear feedback instead of silently proceeding to serve.
const knownOptions = ["config", "port", "preset", "listPresets", "list-presets", "help", "version"];
const unexpected = Object.keys(values).filter((k) => !knownOptions.includes(k) && values[k] !== undefined);
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
    console.error(errorMessage(err));
    process.exit(1);
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
    console.error(message);
    process.exit(1);
  }
  throw err;
}
