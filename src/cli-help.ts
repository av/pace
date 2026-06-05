import { readFileSync } from "node:fs";
import { join } from "node:path";

export const CLI_FATAL_ERROR_PREFIXES = ["config:", "scheduler:", "index:"] as const;

export function isCliFatalStartupError(message: string): boolean {
  return CLI_FATAL_ERROR_PREFIXES.some((p) => message.startsWith(p));
}

export function cliDie(message: string): never {
  console.error(message);
  process.exit(1);
}

export function cliExitOk(stdout: string): never {
  console.log(stdout);
  process.exit(0);
}

export function cliFailWithHelp(stderrLine: string, help: string): never {
  console.error(stderrLine);
  console.log(help);
  process.exit(1);
}

export const CLI_KNOWN_OPTIONS = [
  "config",
  "port",
  "chdir",
  "preset",
  "listPresets",
  "list-presets",
  "help",
  "version",
] as const;

const knownOptionSet = new Set<string>(CLI_KNOWN_OPTIONS);

export function isCliKnownOption(key: string): boolean {
  return knownOptionSet.has(key);
}

export function readPackageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "../package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

export function formatCliHelp(version: string): string {
  return `pace v${version} — personal content dashboard

Usage:
  pace [command] [options]

Commands:
  serve     Start the dashboard server (default)

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -p, --port <number>   Server port (default: 7453, or $PORT)
  -C, --chdir <dir>     Change to directory (for config/data loads; after bootstrap)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
      --list-presets    List available bundled presets
  -h, --help            Show this help
  -v, --version         Show version
`;
}