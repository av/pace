#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const pkg = JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf-8"));

const HELP = `pace v${pkg.version} — personal content dashboard

Usage:
  pace [command] [options]

Commands:
  serve     Start the dashboard server (default)

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -p, --port <number>   Server port (default: 3000, or $PORT)
  -h, --help            Show this help
  -v, --version         Show version
`;

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    config: { type: "string", short: "c" },
    port: { type: "string", short: "p" },
    help: { type: "boolean", short: "h" },
    version: { type: "boolean", short: "v" },
  },
  allowPositionals: true,
  strict: false,
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

if (values.version) {
  console.log(pkg.version);
  process.exit(0);
}

const command = positionals[0] ?? "serve";

if (command !== "serve") {
  console.error(`Unknown command: ${command}\n`);
  console.log(HELP);
  process.exit(1);
}

if (values.config) {
  process.env.PACE_CONFIG = values.config;
}

if (values.port) {
  process.env.PORT = values.port;
}

try {
  await import("./index");
} catch (err) {
  const message = String((err as Error | undefined)?.message ?? err);
  if (message.startsWith("config:") || message.startsWith("scheduler:")) {
    console.error(message);
    process.exit(1);
  }
  throw err;
}
