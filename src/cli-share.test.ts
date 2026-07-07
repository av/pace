import { describe, expect, test } from "bun:test";
import { runCli as runCliProcess } from "./test/cli-runner";
import {
  cliHelpStdout,
  formatShareUsage,
  runCli as runCliInProcess,
  type CliRunDeps,
} from "./cli-help";

function baseDeps(overrides: Partial<CliRunDeps> = {}): CliRunDeps {
  return {
    resolvePreset: () => null,
    listPresets: () => ["tech-news"],
    tryReadRegularFile: () => null,
    ...overrides,
  };
}

async function runCliWithDeps(
  args: string[],
  deps: CliRunDeps,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;
  let status = 0;
  let stdout = "";
  let stderr = "";

  try {
    process.exit = ((code?: number) => {
      status = code ?? 0;
      throw new Error("cliExit");
    }) as typeof process.exit;
    console.log = (message?: unknown) => {
      stdout += `${String(message)}\n`;
    };
    console.error = (message?: unknown) => {
      stderr += `${String(message)}\n`;
    };

    try {
      await runCliInProcess(args, deps);
    } catch (err) {
      if (!(err instanceof Error) || err.message !== "cliExit") {
        throw err;
      }
    }
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return { status, stdout, stderr };
}

describe("pace share", () => {
  test("top-level help includes share commands", () => {
    const result = runCliProcess(["--help"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("share export [dir]");
    expect(result.stdout).toContain("share gist");
  });

  test("share with no subcommand prints share usage", () => {
    const result = runCliProcess(["share"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown subcommand: (none)");
    expect(result.stdout).toContain(formatShareUsage().trim());
  });

  test("share unknown options fail with share usage", () => {
    const result = runCliProcess(["share", "export", "--badflag"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Unknown option(s) for this command: --badflag");
    expect(result.stdout).toContain(formatShareUsage().trim());
    expect(result.stdout).not.toBe(cliHelpStdout());
  });

  test("share export delegates parsed options to dependency", async () => {
    const calls: unknown[] = [];
    const result = await runCliWithDeps(
      [
        "share",
        "export",
        "--output-dir",
        "dist/share",
        "--renderer-url",
        "http://127.0.0.1:7453",
      ],
      baseDeps({
        loadConfig: () => ({ adapters: [], layout: { direction: "row", children: [] } }),
        exportStaticDashboard: (_config, options) => {
          calls.push(options);
          return {
            outputDir: options.outputDir,
            htmlPath: `${options.outputDir}/index.html`,
            cssPath: `${options.outputDir}/styles.css`,
            files: ["index.html", "styles.css"],
            updatedAt: "2026-06-22 00:00:00",
          };
        },
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("exported: dist/share\nhtml: dist/share/index.html\ncss: dist/share/styles.css\n");
    expect(result.stderr).toBe("");
    expect(calls).toEqual([{ outputDir: "dist/share" }]);
  });

  test("share export accepts positional output dir", async () => {
    const calls: unknown[] = [];
    const result = await runCliWithDeps(
      ["share", "export", "snapshot-dir"],
      baseDeps({
        loadConfig: () => ({ adapters: [], layout: { direction: "row", children: [] } }),
        exportStaticDashboard: (_config, options) => {
          calls.push(options);
          return {
            outputDir: options.outputDir,
            htmlPath: `${options.outputDir}/index.html`,
            cssPath: `${options.outputDir}/styles.css`,
            files: ["index.html", "styles.css"],
            updatedAt: "2026-06-22 00:00:00",
          };
        },
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("exported: snapshot-dir\nhtml: snapshot-dir/index.html\ncss: snapshot-dir/styles.css\n");
    expect(calls).toEqual([{ outputDir: "snapshot-dir" }]);
  });

  test("share gist delegates update and visibility options to dependency", async () => {
    const calls: unknown[] = [];
    const result = await runCliWithDeps(
      [
        "share",
        "gist",
        "--gist-id",
        "abc123",
        "--public",
        "--renderer-url",
        "http://localhost:7453",
      ],
      baseDeps({
        loadConfig: () => ({ adapters: [], layout: { direction: "row", children: [] } }),
        publishStaticDashboardToGist: async (_config, options) => {
          calls.push(options);
          return {
            backend: "gist",
            gistUrl: "https://gist.github.com/me/abc123",
            shareUrl: "https://gisthost.github.io/?abc123",
            gistId: options.gistId ?? "generated",
          };
        },
      }),
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("backend: gist");
    expect(result.stdout).toContain("gist: https://gist.github.com/me/abc123");
    expect(result.stdout).toContain("url: https://gisthost.github.io/?abc123");
    expect(result.stderr).toBe("");
    expect(calls).toEqual([
      {
        renderer: "http://localhost:7453",
        gistId: "abc123",
        public: true,
      },
    ]);
  });

  test("share gist defaults to secret and accepts --update alias", async () => {
    const calls: unknown[] = [];
    const result = await runCliWithDeps(
      ["share", "gist", "--update", "existing"],
      baseDeps({
        loadConfig: () => ({ adapters: [], layout: { direction: "row", children: [] } }),
        publishStaticDashboardToGist: async (_config, options) => {
          calls.push(options);
          return {
            backend: "gist",
            gistUrl: "https://gist.github.com/me/existing",
            shareUrl: "https://gisthost.github.io/?existing",
            gistId: options.gistId ?? "generated",
          };
        },
      }),
    );

    expect(result.status).toBe(0);
    expect(calls).toEqual([
      {
        renderer: undefined,
        gistId: "existing",
        public: false,
      },
    ]);
  });

  test("share dependency errors are normalized with share prefix", async () => {
    const result = await runCliWithDeps(
      ["share", "gist"],
      baseDeps({
        loadConfig: () => ({ adapters: [], layout: { direction: "row", children: [] } }),
        publishStaticDashboardToGist: async () => {
          throw new Error("backend unavailable");
        },
      }),
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toBe("share: backend unavailable\n");
    expect(result.stdout).toBe("");
  });

  test("share rejects contradictory visibility and output arguments", () => {
    const visibility = runCliProcess(["share", "gist", "--public", "--secret"]);
    expect(visibility.status).toBe(1);
    expect(visibility.stderr).toContain("Use either --public or --secret");
    expect(visibility.stdout).toContain(formatShareUsage().trim());

    const gistOutput = runCliProcess(["share", "gist", "--output-dir", "other"]);
    expect(gistOutput.status).toBe(1);
    expect(gistOutput.stderr).toContain("Use share export for local output");
    expect(gistOutput.stdout).toContain(formatShareUsage().trim());

    const output = runCliProcess(["share", "export", "dir", "--output-dir", "other"]);
    expect(output.status).toBe(1);
    expect(output.stderr).toContain("Use either [dir] or --output-dir");
    expect(output.stdout).toContain(formatShareUsage().trim());
  });
});
