import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { runCli } from "./test/cli-runner";
import {
  killCliServeServer,
  requestCliServeDashboard,
  requestCliServeHealth,
  requestCliServeRefresh,
  requestCliServeStyles,
  spawnCliServeServer,
  waitForCliServeReady,
} from "./test/cli-serve-harness";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import {
  applyCliConfigEnv,
  applyCliPortEnv,
  cliHelpStdout,
  formatCliHelp,
  formatPresetsUsage,
  getCliCommand,
  isCliFatalStartupError,
  normalizeCliParsedValues,
  parseSkillFrontmatter,
  resolveCliInfoOutput,
  resolveCliServeErrors,
} from "./cli-help";
import {
  expectDashboardFooterUtc,
  expectDashboardHtmlShell,
  expectRefreshPanelFailureOrRedirect,
  expectRefreshPanelNotFound,
  expectSecurityHeaders,
} from "./test/server-harness";

describe("cli-help", () => {
  test("isCliFatalStartupError matches config/scheduler/index prefixes", () => {
    expect(isCliFatalStartupError("config: bad yaml")).toBe(true);
    expect(isCliFatalStartupError("scheduler: boom")).toBe(true);
    expect(isCliFatalStartupError("index: failed to read styles.css")).toBe(true);
    expect(isCliFatalStartupError("server: port 3000 is already in use")).toBe(true);
    expect(isCliFatalStartupError("cli: failed to chdir")).toBe(false);
    expect(isCliFatalStartupError("unexpected")).toBe(false);
  });

  test("normalizeCliParsedValues maps list-presets to listPresets", () => {
    const values = { "list-presets": true } as Record<string, unknown>;
    normalizeCliParsedValues(values);
    expect(values.listPresets).toBe(true);
  });

  test("normalizeCliParsedValues coerces non-boolean list-presets to false", () => {
    const values = { "list-presets": "true" } as Record<string, unknown>;
    normalizeCliParsedValues(values);
    expect(values.listPresets).toBe(false);
  });

  test("applyCliConfigEnv rejects --preset combined with --config", () => {
    let exitCode: number | undefined;
    let stderr = "";
    const origExit = process.exit;
    const origError = console.error;
    const origConfig = process.env.PACE_CONFIG;
    try {
      process.exit = ((code?: number) => {
        exitCode = code ?? 0;
        throw new Error("cliDie");
      }) as typeof process.exit;
      console.error = (msg: string) => {
        stderr = String(msg);
      };
      expect(() =>
        applyCliConfigEnv(
          { preset: "tech-news", config: "/tmp/my.yaml" },
          {
            resolvePreset: () => "/presets/tech-news.yaml",
            listPresets: () => ["tech-news"],
            tryReadRegularFile: () => "ok",
          },
        ),
      ).toThrow("cliDie");
      expect(exitCode).toBe(1);
      expect(stderr).toBe("cli: --preset and --config are mutually exclusive; pass only one");
    } finally {
      process.exit = origExit;
      console.error = origError;
      if (origConfig === undefined) delete process.env.PACE_CONFIG;
      else process.env.PACE_CONFIG = origConfig;
    }
  });

  test("applyCliConfigEnv sets PACE_CONFIG from preset and validates explicit config", () => {
    const orig = process.env.PACE_CONFIG;
    try {
      applyCliConfigEnv(
        { preset: "tech-news" },
        {
          resolvePreset: (name) => (name === "tech-news" ? "/presets/tech-news.yaml" : null),
          listPresets: () => ["tech-news"],
          tryReadRegularFile: () => "ok",
        },
      );
      expect(process.env.PACE_CONFIG).toBe("/presets/tech-news.yaml");

      applyCliConfigEnv(
        { config: "/tmp/my.yaml" },
        {
          resolvePreset: () => null,
          listPresets: () => [],
          tryReadRegularFile: (path) => {
            if (path === "/tmp/my.yaml") return "yaml";
            throw new Error(`config: ${path} is not a regular file`);
          },
        },
      );
      expect(process.env.PACE_CONFIG).toBe("/tmp/my.yaml");

      let missingExit: number | undefined;
      let missingStderr = "";
      const origExit = process.exit;
      const origError = console.error;
      try {
        process.exit = ((code?: number) => {
          missingExit = code ?? 0;
          throw new Error("cliDie");
        }) as typeof process.exit;
        console.error = (msg: string) => {
          missingStderr = String(msg);
        };
        expect(() =>
          applyCliConfigEnv(
            { config: "/tmp/missing.yaml" },
            {
              resolvePreset: () => null,
              listPresets: () => [],
              tryReadRegularFile: () => null,
            },
          ),
        ).toThrow("cliDie");
        expect(missingExit).toBe(1);
        expect(missingStderr).toBe("config: file not found: /tmp/missing.yaml");
      } finally {
        process.exit = origExit;
        console.error = origError;
      }
    } finally {
      if (orig === undefined) delete process.env.PACE_CONFIG;
      else process.env.PACE_CONFIG = orig;
    }
  });

  test("resolveCliInfoOutput dispatches help, version, and list-presets", () => {
    const ctx = {
      version: "9.9.9",
      help: "HELP TEXT",
      listPresets: () => ["alpha", "beta"],
    };
    expect(resolveCliInfoOutput({ help: true }, ctx)).toBe("HELP TEXT");
    expect(resolveCliInfoOutput({ version: true }, ctx)).toBe("9.9.9");
    expect(resolveCliInfoOutput({ listPresets: true }, ctx)).toBe("alpha\nbeta");
    expect(resolveCliInfoOutput({}, ctx)).toBeNull();
  });

  test("cliHelpStdout matches formatCliHelp plus console.log newline", () => {
    expect(cliHelpStdout("1.2.3")).toBe(formatCliHelp("1.2.3") + "\n");
  });

  test("getCliCommand resolves known commands and rejects removed aliases", () => {
    expect(getCliCommand("transforms")?.name).toBe("transforms");
    expect(getCliCommand("tq")).toBeUndefined();
  });

  test("formatCliHelp returns exact help text", () => {
    expect(formatCliHelp("1.0.0")).toBe(
      `pace v1.0.0 - personal content dashboard

If you're an agent, start here:
  pace skill                          list agent skills
  pace skill pace-setup     set up / run a dashboard
  pace skill pace-config create or edit config.yaml

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
  share export [dir]       Export a static dashboard snapshot
  share gist               Publish a static dashboard snapshot to GitHub Gist
  config check [path]      Validate a config file

Options:
  -c, --config <path>   Path to config file (default: ./config.yaml)
  -p, --port <number>   Server port (default: 7453, or $PORT)
  -C, --chdir <dir>     Change to directory (for config/data loads; after bootstrap)
  -P, --preset <name>   Use a bundled preset (tech-news, ml-ai, etc.)
      --list-presets    List available bundled presets
  -h, --help            Show this help
  -v, --version         Show version
`,
    );
  });

  test("parseSkillFrontmatter extracts name and description from block scalar", () => {
    const content = `---
name: pace-setup
description: >
  Install and run the pace personal dashboard. Covers cloning, dependency install via Bun,
  Docker and Docker Compose deployment.
---

# Body
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("pace-setup");
    expect(result!.description).toContain("Install and run the pace personal dashboard");
  });

  test("parseSkillFrontmatter extracts name and description from inline scalar", () => {
    const content = `---
name: my-skill
description: A short description of the skill.
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    expect(result!.description).toBe("A short description of the skill");
  });

  test("parseSkillFrontmatter handles block scalar strip variant >-", () => {
    const content = `---
name: my-skill
description: >-
  This is the description line.
  Second line here.
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.name).toBe("my-skill");
    expect(result!.description).toContain("This is the description line");
  });

  test("parseSkillFrontmatter handles block scalar strip variant |-", () => {
    const content = `---
name: my-skill
description: |-
  Literal block strip description.
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.description).toContain("Literal block strip description");
  });

  test("parseSkillFrontmatter handles block scalar keep variant >+", () => {
    const content = `---
name: my-skill
description: >+
  Keep variant description.
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.description).toContain("Keep variant description");
  });

  test("parseSkillFrontmatter strips surrounding double quotes from inline scalar", () => {
    const content = `---
name: my-skill
description: "A quoted description."
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.description).toBe("A quoted description");
    expect(result!.description).not.toMatch(/^"/);
  });

  test("parseSkillFrontmatter strips surrounding single quotes from inline scalar", () => {
    const content = `---
name: my-skill
description: 'Single quoted description.'
---
`;
    const result = parseSkillFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.description).toBe("Single quoted description");
    expect(result!.description).not.toMatch(/^'/);
  });

  test("resolveCliServeErrors rejects unknown options", () => {
    expect(resolveCliServeErrors({}, undefined)).toBeNull();
    expect(resolveCliServeErrors({}, "serve")).toBeNull();

    expect(resolveCliServeErrors({ badflag: true, prt: true }, "serve")).toEqual({
      stderr: "Unknown option(s): --badflag, --prt\n",
      showHelp: true,
    });
    expect(resolveCliServeErrors({ help: true }, "serve")).toBeNull();
  });

  test("applyCliPortEnv sets PORT for valid values and no-ops when unset", () => {
    const orig = process.env.PORT;
    try {
      delete process.env.PORT;
      applyCliPortEnv(undefined);
      expect(process.env.PORT).toBeUndefined();

      applyCliPortEnv("8080");
      expect(process.env.PORT as string | undefined).toBe("8080");
    } finally {
      if (orig === undefined) delete process.env.PORT;
      else process.env.PORT = orig;
    }
  });
});

describe("cli", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(os.tmpdir(), "pace-cli-test-"));
  });

  afterEach(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("--help/-h prints usage", () => {
    const help = cliHelpStdout();
    for (const flag of ["--help", "-h"]) {
      const res = runCli([flag]);
      expect(res.status).toBe(0);
      expect(res.stdout).toBe(help);
      expect(res.stderr).toBe("");
    }
  });

  test("--version prints version and exits 0", () => {
    const res = runCli(["--version"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim().length).toBeGreaterThan(0);
    expect(res.stdout).not.toContain("Usage:");
    expect(res.stderr).toBe("");
  });

  test("unknown command prints HELP", () => {
    const res = runCli(["foo"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: foo");
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("unknown options rejected with HELP", () => {
    const res = runCli(["--badflag", "--prt"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown option(s): --badflag, --prt");
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("pace presets list output equals --list-presets output", () => {
    const listRes = runCli(["--list-presets"]);
    const subcmdRes = runCli(["presets", "list"]);
    expect(listRes.status).toBe(0);
    expect(subcmdRes.status).toBe(0);
    expect(subcmdRes.stdout).toBe(listRes.stdout);
    expect(subcmdRes.stderr).toBe("");
  });

  test("pace presets bogus → exit 1, stderr Unknown subcommand", () => {
    const res = runCli(["presets", "bogus"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown subcommand: bogus");
    expect(res.stdout).toContain(formatPresetsUsage().trim());
  });

  test("pace bogus → exit 1, stderr Unknown command", () => {
    const res = runCli(["bogus"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: bogus");
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("pace tq list → exit 1, stderr Unknown command (removed alias)", () => {
    const res = runCli(["tq", "list"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown command: tq");
    expect(res.stdout).toBe(cliHelpStdout());
  });

  test("pace presets with no subcommand → exit 1, stderr Unknown subcommand, presets usage", () => {
    const res = runCli(["presets"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown subcommand");
    expect(res.stdout).toContain(formatPresetsUsage().trim());
  });

  test("pace presets list extra → exit 1, stderr Unknown subcommand, presets usage", () => {
    const res = runCli(["presets", "list", "extra"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown subcommand");
    expect(res.stdout).toContain(formatPresetsUsage().trim());
  });

  test("pace presets list rejects serve-only flags like --port", () => {
    const res = runCli(["presets", "list", "--port", "7777"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--port");
    expect(res.stdout).toContain(formatPresetsUsage().trim());
  });

  test("invalid --port rejected", () => {
    const res = runCli(["--port", "99999"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: invalid --port value "99999"');
    expect(res.stdout).toBe("");
  });

  test("partial numeric --port rejected (no parseInt prefix acceptance)", () => {
    const res = runCli(["--port", "8080abc"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: invalid --port value "8080abc"');
    expect(res.stdout).toBe("");
  });

  test("--config non-regular file rejected", () => {
    const res = runCli(["--config", tmpDir]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`config: ${tmpDir} is not a regular file`);
    expect(res.stdout).toBe("");
  });

  test("--config missing file rejected at CLI validation", () => {
    const missing = join(tmpDir, "does-not-exist.yaml");
    const res = runCli(["--config", missing]);
    expect(res.status).toBe(1);
    expect(res.stderr.trim()).toBe(`config: file not found: ${missing}`);
    expect(res.stdout).toBe("");
  });

  test("unknown --preset lists available presets", () => {
    const res = runCli(["--preset", "not-a-real-preset"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('cli: unknown preset "not-a-real-preset"');
    expect(res.stderr).toContain("Available:");
    expect(res.stderr).toContain("tech-news");
    expect(res.stdout).toBe("");
  });

  test("bad YAML config surfaces config: error", () => {
    const badCfg = join(tmpDir, "bad.yaml");
    writeFileSync(badCfg, "not: valid: yaml: [");
    const res = runCli(["--config", badCfg]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("config: failed to parse YAML from");
    expect(res.stderr).toContain(badCfg);
  });

  test("pace skill lists skills from skills/ directory", () => {
    const res = runCli(["skill"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("pace-setup");
    expect(res.stdout).toContain("pace-config");
    expect(res.stdout).toContain("pace skill <name>");
  });

  test("pace skill pace-setup prints full SKILL.md with known heading", () => {
    const res = runCli(["skill", "pace-setup"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("# Set up and run pace");
    expect(res.stdout).toContain("---");
    expect(res.stdout).toContain("name: pace-setup");
  });

  test("pace skill pace-config prints full SKILL.md", () => {
    const res = runCli(["skill", "pace-config"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("# Configure a pace dashboard");
  });

  test("pace skill nope → exit 1 with available list", () => {
    const res = runCli(["skill", "nope"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown skill: nope");
    expect(res.stderr).toContain("Available:");
    expect(res.stderr).toContain("pace-setup");
  });

  test("--chdir/-C accepted; invalid dir fails with cli: chdir message", () => {
    const bad = join(tmpDir, "nonexistent-chdir-subdir-xyz");
    const resBad = runCli(["--chdir", bad, "--version"]);
    expect(resBad.status).toBe(1);
    expect(resBad.stderr).toContain(`cli: failed to chdir to ${bad}:`);
    expect(resBad.stderr).toContain(bad);
    expect(resBad.stdout).toBe("");
    const resValidThenPort = runCli(["-C", tmpDir, "--port", "99999"]);
    expect(resValidThenPort.status).toBe(1);
    expect(resValidThenPort.stderr).toContain('cli: invalid --port value "99999"');
    expect(resValidThenPort.stderr).not.toContain("Unknown option");
    expect(resValidThenPort.stdout).toBe("");
  });
});

describe("cli serve", () => {
  test("health, styles cache, refresh errors, security headers", async () => {
    const harness = spawnCliServeServer();
    try {
      try {
        unlinkSync(harness.dbPath);
      } catch {
        // fresh start
      }
      await waitForCliServeReady(harness, 12_000);
      const dashboard = await requestCliServeDashboard(harness);
      expect(dashboard.status).toBe(200);
      expect(dashboard.hd["content-type"] || "").toMatch(/text\/html/);
      expectDashboardHtmlShell(String(dashboard.body));
      expectDashboardFooterUtc(String(dashboard.body));
      expectSecurityHeaders(dashboard.hd);
      const health = await requestCliServeHealth(harness);
      expect(health.status).toBe(200);
      const healthBody = health.body as { status: string; sources: Array<{ name: string; status: string }> };
      // Live server may or may not have completed a refresh yet, and fixture
      // sources can fail — health must report honestly either way.
      expect(["ok", "degraded"]).toContain(healthBody.status);
      expect(Array.isArray(healthBody.sources)).toBe(true);
      expect(healthBody.sources.length).toBeGreaterThan(0);
      for (const source of healthBody.sources) {
        expect(["ok", "failing", "pending"]).toContain(source.status);
      }
      expect(healthBody.status).toBe(
        healthBody.sources.some((source) => source.status === "failing") ? "degraded" : "ok",
      );
      const styles = await requestCliServeStyles(harness);
      expect(styles.status).toBe(200);
      expect(styles.hd["cache-control"] || "").toContain("max-age=3600");
      const r502 = await requestCliServeRefresh(harness, "fediverse");
      await expectRefreshPanelFailureOrRedirect(r502, "lemmy");
      const r404 = await requestCliServeRefresh(harness, "unknownpanel-iter6");
      await expectRefreshPanelNotFound(r404, "unknownpanel-iter6");
      expectSecurityHeaders(health.hd);
      expectSecurityHeaders(styles.hd);
      expectSecurityHeaders(r502);
      expectSecurityHeaders(r404);
    } finally {
      await killCliServeServer(harness);
      try {
        unlinkSync(harness.dbPath);
      } catch {
        // already removed
      }
    }
  }, 15000);
});
