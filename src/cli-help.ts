import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readConfigSource } from "./config";
import { errorMessage, normalizeParamBoolean, parseCliPort } from "./utils";

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

export const CLI_PARSE_OPTIONS = {
  config: { type: "string", short: "c" },
  port: { type: "string", short: "p" },
  chdir: { type: "string", short: "C" },
  preset: { type: "string", short: "P" },
  listPresets: { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
} as const;

export const CLI_KNOWN_OPTIONS = [
  ...Object.keys(CLI_PARSE_OPTIONS),
  "list-presets",
] as const;

const knownOptionSet = new Set<string>(CLI_KNOWN_OPTIONS);

export function isCliKnownOption(key: string): boolean {
  return knownOptionSet.has(key);
}

export type CliParsedValues = Record<string, unknown> & {
  config?: string;
  port?: string;
  chdir?: string;
  preset?: string;
  listPresets?: boolean;
};

/** Map kebab-case flags from parseArgs (e.g. list-presets) onto camelCase fields. */
export function normalizeCliParsedValues(values: CliParsedValues): void {
  if (values["list-presets"] !== undefined) {
    values.listPresets = normalizeParamBoolean(values, "list-presets");
  }
}

export type CliConfigDeps = {
  resolvePreset: (name: string) => string | null;
  listPresets: () => string[];
  tryReadRegularFile: (path: string) => string | null;
};

export type CliRunDeps = CliConfigDeps;

type CliInfoContext = {
  version: string;
  help: string;
  listPresets: () => string[];
};

const CLI_INFO_COMMANDS: ReadonlyArray<{
  isRequested: (values: CliParsedValues) => boolean;
  render: (ctx: CliInfoContext) => string;
}> = [
  { isRequested: (values) => !!values.help, render: (ctx) => ctx.help },
  { isRequested: (values) => !!values.version, render: (ctx) => ctx.version },
  {
    isRequested: (values) => !!values.listPresets,
    render: (ctx) => ctx.listPresets().join("\n"),
  },
];

/** Apply --chdir after bootstrap. No-op when unset. */
export function applyCliChdir(target: string | undefined): void {
  if (target === undefined) return;

  try {
    process.chdir(target);
  } catch (err) {
    cliDie(`cli: failed to chdir to ${target}: ${errorMessage(err)}`);
  }
}

/** Resolve stdout for --help / --version / --list-presets, or null when serve should continue. */
export function resolveCliInfoOutput(
  values: CliParsedValues,
  ctx: CliInfoContext,
): string | null {
  for (const cmd of CLI_INFO_COMMANDS) {
    if (cmd.isRequested(values)) return cmd.render(ctx);
  }
  return null;
}

export function runCliInfoExits(values: CliParsedValues, ctx: CliInfoContext): void {
  const output = resolveCliInfoOutput(values, ctx);
  if (output !== null) cliExitOk(output);
}

export type CliServeValidationError = {
  stderr: string;
  showHelp: boolean;
};

/** Validate default serve command and known options only. */
export function resolveCliServeErrors(
  values: Record<string, unknown>,
  command: string | undefined,
): CliServeValidationError | null {
  const cmd = command ?? "serve";
  if (cmd !== "serve") {
    return { stderr: `Unknown command: ${cmd}\n`, showHelp: true };
  }

  const unexpected = Object.keys(values).filter(
    (key) => !isCliKnownOption(key) && values[key] !== undefined,
  );
  if (unexpected.length > 0) {
    return {
      stderr: `Unknown option(s): ${unexpected.map((option) => "--" + option).join(", ")}\n`,
      showHelp: true,
    };
  }

  return null;
}

export function assertCliServeInvocation(
  values: Record<string, unknown>,
  command: string | undefined,
  help: string,
): void {
  const error = resolveCliServeErrors(values, command);
  if (error) cliFailWithHelp(error.stderr, help);
}

function validateExplicitConfigPath(
  path: string,
  readFile: CliConfigDeps["tryReadRegularFile"],
): void {
  try {
    readConfigSource({ path, explicit: true }, readFile);
  } catch (err) {
    cliDie(errorMessage(err));
  }
}

/** Apply --preset / --config to PACE_CONFIG after validating the config path exists. */
export function applyCliConfigEnv(
  values: Pick<CliParsedValues, "config" | "preset">,
  deps: CliConfigDeps,
): void {
  if (values.preset && !values.config) {
    const resolved = deps.resolvePreset(values.preset);
    if (!resolved) {
      cliDie(
        `cli: unknown preset "${values.preset}"\nAvailable: ${deps.listPresets().join(", ")}`,
      );
    }
    validateExplicitConfigPath(resolved, deps.tryReadRegularFile);
    process.env.PACE_CONFIG = resolved;
    return;
  }

  if (!values.config) return;

  validateExplicitConfigPath(values.config, deps.tryReadRegularFile);
  process.env.PACE_CONFIG = values.config;
}

/** Apply validated --port to PORT. No-op when port is unset. */
export function applyCliPortEnv(port: string | undefined): void {
  if (port === undefined) return;

  const n = parseCliPort(port);
  if (n === null) {
    cliDie(
      `cli: invalid --port value "${port}" (must be an integer between 1 and 65535)`,
    );
  }
  process.env.PORT = String(n);
}

export function readPackageVersion(): string {
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dir, "../package.json"), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

export async function bootstrapServeModule(
  values: Pick<CliParsedValues, "config" | "preset" | "port">,
  deps: CliConfigDeps,
): Promise<void> {
  applyCliConfigEnv(values, deps);
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
}

export async function runCli(argv: string[], deps: CliRunDeps): Promise<void> {
  const version = readPackageVersion();
  const help = formatCliHelp(version);

  const { values, positionals } = parseArgs({
    args: argv,
    options: CLI_PARSE_OPTIONS,
    allowPositionals: true,
    strict: false,
  });

  normalizeCliParsedValues(values);
  applyCliChdir(values.chdir);
  runCliInfoExits(values, { version, help, listPresets: deps.listPresets });
  assertCliServeInvocation(values, positionals[0], help);
  await bootstrapServeModule(values, deps);
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