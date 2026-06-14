import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { writeCliStderr, writeCliStdout } from "./cli-log";
import { readConfigSource, resolveConfigPath, tryReadRegularFile as defaultReadFile } from "./config";
import { DEFAULT_LAYOUT } from "./config/domain";
import { validateParsedConfig } from "./config-validate";
import { validateTransforms } from "./transform-validate";
import { bootstrapServer } from "./server/bootstrap";
import { ADAPTER_DOCS } from "./adapters/adapter-docs";
import { ADAPTER_TYPES } from "./adapters/params";
import { TRANSFORM_DOCS } from "./transform-docs";
import { TRANSFORM_TYPES } from "./transform-schema";
import { isRecord } from "./config/types";
import { errorMessage, normalizeParamBoolean, parseCliPort } from "./utils";

export const CLI_FATAL_ERROR_PREFIXES = ["config:", "scheduler:", "index:"] as const;

export function isCliFatalStartupError(message: string): boolean {
  return CLI_FATAL_ERROR_PREFIXES.some((p) => message.startsWith(p));
}

export function cliDie(message: string): never {
  writeCliStderr(message);
  process.exit(1);
}

export function cliExitOk(stdout: string): never {
  writeCliStdout(stdout);
  process.exit(0);
}

export function cliFailWithHelp(stderrLine: string, help: string): never {
  writeCliStderr(stderrLine);
  writeCliStdout(help);
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

/** Options that are only valid for the serve command. */
const SERVE_ONLY_OPTIONS = new Set(["config", "port", "chdir", "preset"]);

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

export type CliServeModuleDeps = CliConfigDeps & {
  bootstrapServer?: typeof bootstrapServer;
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

/** Validate serve options. Only valid when command is "serve" or default (undefined). */
export function resolveCliServeErrors(
  values: Record<string, unknown>,
  command: string | undefined,
): CliServeValidationError | null {
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
  deps: CliServeModuleDeps,
): Promise<void> {
  applyCliConfigEnv(values, deps);
  applyCliPortEnv(values.port);
  const startServer = deps.bootstrapServer ?? bootstrapServer;
  try {
    await startServer();
  } catch (err) {
    const message = errorMessage(err);
    if (isCliFatalStartupError(message)) {
      cliDie(message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Command registry
// ---------------------------------------------------------------------------

export type CliCommandContext = {
  version: string;
  help: string;
  deps: CliRunDeps;
};

export type CliCommand = {
  name: string;
  summary: string;
  usage: string;
  run(
    positionals: string[],
    values: CliParsedValues,
    ctx: CliCommandContext,
  ): Promise<void>;
};

export function formatPresetsUsage(): string {
  return `Usage: pace presets <subcommand>

Subcommands:
  list     List bundled preset configs
`;
}

export function formatAdaptersUsage(): string {
  return `Usage: pace adapters <subcommand>

Subcommands:
  list          List all adapter types with a one-line summary
  explain <type>  Show full documentation for an adapter type
`;
}

export function formatTransformsUsage(): string {
  return `Usage: pace transforms <subcommand>

Subcommands:
  list          List all transform types with a one-line summary
  explain <type>  Show full documentation for a transform type
`;
}

export function formatConfigUsage(): string {
  return `Usage: pace config <subcommand>

Subcommands:
  check [path]  Validate a config file (defaults to serve resolution order)
`;
}

/** Format a param table row: "  <name>  <type>  <default>  <constraints>  <description>" */
function formatParamRow(
  name: string,
  p: { type: string; required?: true; default?: string; constraints?: string; description: string },
): string {
  const parts: string[] = [name, p.type];
  if (p.required) {
    parts.push("required");
  } else if (p.default !== undefined) {
    parts.push(p.default);
  } else {
    parts.push("-");
  }
  if (p.constraints) parts.push(p.constraints);
  parts.push(p.description);
  return "  " + parts.join("  ");
}

export function formatAdapterExplain(adapterType: string): string {
  const doc = ADAPTER_DOCS[adapterType as keyof typeof ADAPTER_DOCS];
  if (!doc) {
    const available = ADAPTER_TYPES.join(", ");
    cliDie(`unknown adapter type "${adapterType}"\nAvailable: ${available}`);
  }
  const paramLines = Object.entries(doc.params)
    .map(([name, p]) => formatParamRow(name, p))
    .join("\n");
  return `adapter: ${adapterType}
summary: ${doc.summary}

example:
${doc.example.split("\n").map((l) => "  " + l).join("\n")}

params:
${paramLines}

common to all adapters: name, refresh_interval (minutes, default 15, min 1 clamped at runtime), transforms`;
}

export function formatTransformExplain(transformType: string): string {
  const doc = TRANSFORM_DOCS[transformType as keyof typeof TRANSFORM_DOCS];
  if (!doc) {
    const available = TRANSFORM_TYPES.join(", ");
    cliDie(`unknown transform type "${transformType}"\nAvailable: ${available}`);
  }
  const paramLines = Object.entries(doc.params)
    .map(([name, p]) => formatParamRow(name, p))
    .join("\n");
  const noteSection = doc.note ? `\nnote: ${doc.note}` : "";
  const paramsSection = paramLines
    ? `\nparams:\n${paramLines}`
    : "\nparams: (none)";
  return `transform: ${transformType}
summary: ${doc.summary}

example:
${doc.example.split("\n").map((l) => "  " + l).join("\n")}${paramsSection}${noteSection}`;
}

/** Load and validate a config file; returns summary string or throws with config: prefix. */
export function checkConfig(
  pathOverride: string | undefined,
  readFile: (path: string) => string | null = defaultReadFile,
): string {
  const resolution = pathOverride
    ? { path: pathOverride, explicit: true }
    : resolveConfigPath(process.env.PACE_CONFIG);

  const read = readConfigSource(resolution, readFile);
  if (read === null) {
    throw new Error("config: no config file found");
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = yaml.load(read.raw) as Record<string, unknown>;
  } catch (err) {
    const reason = errorMessage(err).split("\n")[0];
    throw new Error(`config: failed to parse YAML from ${read.usedConfigPath}: ${reason}`);
  }

  if (parsed === undefined || parsed === null) {
    return "config OK: 0 adapters, 0 pipelines, 0 panels";
  }
  if (!isRecord(parsed)) {
    throw new Error("config: top-level config must be an object");
  }

  const { adapters, pipelines, layout } = validateParsedConfig(parsed, DEFAULT_LAYOUT);

  // Count panels in layout
  function countPanels(node: unknown): number {
    if (!isRecord(node)) return 0;
    if ("panel" in node) return 1;
    if ("children" in node && Array.isArray(node.children)) {
      return (node.children as unknown[]).reduce<number>(
        (sum, child) => sum + countPanels(child),
        0,
      );
    }
    return 0;
  }

  const panelCount = countPanels(layout);
  const pipelineCount = pipelines?.length ?? 0;
  return `config OK: ${adapters.length} adapters, ${pipelineCount} pipelines, ${panelCount} panels`;
}

// ---------------------------------------------------------------------------
// Skill discovery
// ---------------------------------------------------------------------------

export type SkillEntry = {
  name: string;
  description: string;
};

/** Parse `name:` and first line of `description:` from SKILL.md YAML frontmatter. */
export function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;
  const fm = fmMatch[1];

  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  if (!nameMatch) return null;
  const name = nameMatch[1].trim();

  // description may be a scalar or a YAML block scalar (>)
  const descMatch = fm.match(/^description:\s*(.*)$/m);
  if (!descMatch) return null;

  let description: string;
  const inline = descMatch[1].trim();
  if (inline === "" || inline.startsWith(">") || inline.startsWith("|")) {
    // Block scalar: collect indented lines until next non-indented key
    const afterDesc = fm.slice(fm.indexOf(descMatch[0]) + descMatch[0].length);
    const blockLines = afterDesc.split(/\r?\n/).slice(1);
    const indentedLines: string[] = [];
    for (const line of blockLines) {
      if (line.match(/^\s+/) || line === "") {
        indentedLines.push(line.trim());
      } else {
        break;
      }
    }
    description = indentedLines.filter((l) => l !== "").join(" ");
  } else {
    description = inline;
    // Strip surrounding matching quotes
    if (
      (description.startsWith('"') && description.endsWith('"')) ||
      (description.startsWith("'") && description.endsWith("'"))
    ) {
      description = description.slice(1, -1);
    }
  }

  // Take only first sentence/line
  description = description.split(/\.\s/)[0].replace(/\.$/, "");

  return { name, description };
}

/** List all skills with SKILL.md under the skills/ directory relative to cwd. */
export function listSkills(): SkillEntry[] {
  const skillsDir = join(process.cwd(), "skills");
  if (!existsSync(skillsDir)) return [];

  const entries: SkillEntry[] = [];
  for (const dir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const skillPath = join(skillsDir, dir.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    const content = readFileSync(skillPath, "utf-8");
    const fm = parseSkillFrontmatter(content);
    if (!fm) continue;
    entries.push({ name: fm.name, description: fm.description });
  }
  return entries;
}

/** Read full SKILL.md content for a named skill, or null if not found. */
export function readSkillContent(name: string): string | null {
  const skillPath = join(process.cwd(), "skills", name, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  return readFileSync(skillPath, "utf-8");
}

export function formatSkillList(skills: SkillEntry[]): string {
  if (skills.length === 0) return "No skills found.\n";
  const maxLen = Math.max(...skills.map((s) => s.name.length));
  const rows = skills.map((s) => `${s.name.padEnd(maxLen)}  ${s.description}`).join("\n");
  return `${rows}\n\nRun \`pace skill <name>\` to print the full skill.`;
}

/** Reject serve-only flags when used with info/subcommands. */
function rejectServeOnlyFlags(
  values: CliParsedValues,
  usageBlock: string,
  exclude?: ReadonlySet<string>,
): void {
  const rejected = Object.keys(values).filter(
    (key) => SERVE_ONLY_OPTIONS.has(key) && values[key] !== undefined && !exclude?.has(key),
  );
  if (rejected.length > 0) {
    cliFailWithHelp(
      `Unknown option(s) for this command: ${rejected.map((k) => "--" + k).join(", ")}\n`,
      usageBlock,
    );
  }
}

const CLI_COMMANDS: CliCommand[] = [
  {
    name: "serve",
    summary: "Run the dashboard server (default)",
    usage: "",
    async run(_positionals, values, ctx) {
      await bootstrapServeModule(values, ctx.deps);
    },
  },
  {
    name: "presets",
    summary: "Manage bundled preset configs",
    usage: formatPresetsUsage(),
    async run(positionals, values, ctx) {
      const sub = positionals[0];
      const usage = formatPresetsUsage();
      rejectServeOnlyFlags(values, usage);
      if (sub === "list") {
        if (positionals.length > 1) {
          cliFailWithHelp(`Unknown subcommand: ${positionals[1]}\n`, usage);
        }
        cliExitOk(ctx.deps.listPresets().join("\n"));
      } else {
        cliFailWithHelp(
          sub === undefined ? "Unknown subcommand: (none)\n" : `Unknown subcommand: ${sub}\n`,
          usage,
        );
      }
    },
  },
  {
    name: "adapters",
    summary: "List or explain adapter types",
    usage: formatAdaptersUsage(),
    async run(positionals, values) {
      const sub = positionals[0];
      const usage = formatAdaptersUsage();
      rejectServeOnlyFlags(values, usage);
      if (sub === "list") {
        cliExitOk(
          ADAPTER_TYPES.map((t) => `${t} - ${ADAPTER_DOCS[t].summary}`).join("\n"),
        );
      } else if (sub === "explain") {
        const type = positionals[1];
        if (!type) {
          cliFailWithHelp("Missing adapter type argument\n", usage);
        }
        cliExitOk(formatAdapterExplain(type));
      } else {
        cliFailWithHelp(
          sub === undefined ? "Unknown subcommand: (none)\n" : `Unknown subcommand: ${sub}\n`,
          usage,
        );
      }
    },
  },
  {
    name: "transforms",
    summary: "List or explain transform types",
    usage: formatTransformsUsage(),
    async run(positionals, values) {
      const sub = positionals[0];
      const usage = formatTransformsUsage();
      rejectServeOnlyFlags(values, usage);
      if (sub === "list") {
        cliExitOk(
          TRANSFORM_TYPES.map((t) => `${t} - ${TRANSFORM_DOCS[t].summary}`).join("\n"),
        );
      } else if (sub === "explain") {
        const type = positionals[1];
        if (!type) {
          cliFailWithHelp("Missing transform type argument\n", usage);
        }
        cliExitOk(formatTransformExplain(type));
      } else {
        cliFailWithHelp(
          sub === undefined ? "Unknown subcommand: (none)\n" : `Unknown subcommand: ${sub}\n`,
          usage,
        );
      }
    },
  },
  {
    name: "skill",
    summary: "List or print agent skills",
    usage: `Usage: pace skill [name]

  pace skill           List all bundled agent skills
  pace skill <name>    Print the full skill document
`,
    async run(positionals, values) {
      rejectServeOnlyFlags(values, "Usage: pace skill [name]\n");
      const name = positionals[0];
      if (name === undefined) {
        const skills = listSkills();
        cliExitOk(formatSkillList(skills));
      } else {
        const content = readSkillContent(name);
        if (content === null) {
          const skills = listSkills();
          const available = skills.map((s) => s.name).join(", ");
          writeCliStderr(`Unknown skill: ${name}\nAvailable: ${available}`);
          process.exit(1);
        }
        cliExitOk(content);
      }
    },
  },
  {
    name: "config",
    summary: "Validate config file",
    usage: formatConfigUsage(),
    async run(positionals, values) {
      const usage = formatConfigUsage();
      // --config is valid for `config check`; exclude it from the serve-only rejection
      const CONFIG_COMMAND_ALLOWED = new Set(["config"]);
      rejectServeOnlyFlags(values, usage, CONFIG_COMMAND_ALLOWED);
      const sub = positionals[0];
      if (sub === "check") {
        // Resolution order: positional path > --config > PACE_CONFIG > default
        const pathOverride = positionals[1] ?? values.config;
        try {
          const summary = checkConfig(pathOverride);
          cliExitOk(summary);
        } catch (err) {
          cliDie(errorMessage(err));
        }
      } else {
        cliFailWithHelp(
          sub === undefined ? "Unknown subcommand: (none)\n" : `Unknown subcommand: ${sub}\n`,
          usage,
        );
      }
    },
  },
];

const CLI_COMMAND_MAP = new Map<string, CliCommand>(CLI_COMMANDS.map((c) => [c.name, c]));

export function getCliCommand(name: string): CliCommand | undefined {
  return CLI_COMMAND_MAP.get(name);
}

export function getCliCommands(): CliCommand[] {
  return CLI_COMMANDS;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runCli(argv: string[], deps: CliRunDeps): Promise<void> {
  const version = readPackageVersion();
  const help = formatCliHelp(version);

  const { values: rawValues, positionals } = parseArgs({
    args: argv,
    options: CLI_PARSE_OPTIONS,
    allowPositionals: true,
    strict: false,
  });
  const values = rawValues as CliParsedValues;

  normalizeCliParsedValues(values);
  applyCliChdir(values.chdir);
  runCliInfoExits(values, { version, help, listPresets: deps.listPresets });

  // --list-presets is an alias for `presets list`
  // (already handled above via runCliInfoExits)

  const commandName = positionals[0];

  if (commandName === undefined) {
    // No positional → default serve
    assertCliServeInvocation(values, undefined, help);
    await bootstrapServeModule(values, deps);
    return;
  }

  const command = getCliCommand(commandName);
  if (!command) {
    cliFailWithHelp(`Unknown command: ${commandName}\n`, help);
  }

  const ctx: CliCommandContext = { version, help, deps };

  if (command.name === "serve") {
    // serve keeps current isCliKnownOption validation
    assertCliServeInvocation(values, "serve", help);
    await command.run(positionals.slice(1), values, ctx);
    return;
  }

  // All other commands: pass remaining positionals
  await command.run(positionals.slice(1), values, ctx);
}

/** Bytes written to stdout by `cliExitOk(formatCliHelp(version))`. */
export function cliHelpStdout(version?: string): string {
  return formatCliHelp(version ?? readPackageVersion()) + "\n";
}

export function formatCliHelp(version: string): string {
  return `pace v${version} - personal content dashboard

If you're an agent, start here:
  pace skill                          list agent skills
  pace skill pace-dashboard-setup     set up / run a dashboard
  pace skill pace-dashboard-configure create or edit config.yaml

Usage:
  pace [command] [options]

Commands:
  serve                    Run the dashboard server (default)
  skill [name]             List or print agent skills
  presets list             List bundled preset configs
  adapters list            List all adapter types
  adapters explain <type>  Show adapter documentation
  transforms list          List all transform types
  transforms explain <type>  Show transform documentation
  config check [path]      Validate a config file

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
