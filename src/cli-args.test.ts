import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { runCli } from "./test/cli-runner";
import { resolveCliMissingValueError } from "./cli-help";

describe("cli argument validation", () => {
  describe("unknown options on subcommands", () => {
    test("presets list rejects unknown flags (previously silently ignored)", () => {
      const res = runCli(["presets", "list", "--bogus"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unknown option(s) for this command: --bogus");
      expect(res.stdout).toContain("Usage: pace presets");
    });

    test("adapters list rejects share-only flags", () => {
      const res = runCli(["adapters", "list", "--public"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unknown option(s) for this command: --public");
    });

    test("transforms explain rejects gist flags", () => {
      const res = runCli(["transforms", "explain", "rank", "--gist-id", "abc"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unknown option(s) for this command: --gist-id");
    });

    test("skill rejects unknown flags", () => {
      const res = runCli(["skill", "--bogus"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unknown option(s) for this command: --bogus");
    });

    test("config check still accepts --config", () => {
      const dir = mkdtempSync(join(os.tmpdir(), "pace-cli-args-"));
      try {
        const cfg = join(dir, "config.yaml");
        writeFileSync(cfg, "{}\n");
        const res = runCli(["config", "check", "--config", cfg]);
        expect(res.status).toBe(0);
        expect(res.stdout).toContain("config OK");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    test("valid subcommand invocations still work", () => {
      expect(runCli(["presets", "list"]).status).toBe(0);
      expect(runCli(["adapters", "list"]).status).toBe(0);
    });
  });

  describe("string options without a value", () => {
    test("bare --config fails with a clear message instead of using path 'true'", () => {
      const res = runCli(["--config"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Option(s) missing required value: --config");
      expect(res.stderr).not.toContain("file not found: true");
    });

    test("bare -p (port) fails with the missing-value message", () => {
      const res = runCli(["-p"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Option(s) missing required value: --port");
    });

    test("resolveCliMissingValueError lists all valueless string options", () => {
      expect(resolveCliMissingValueError({ config: true, update: true })).toBe(
        "Option(s) missing required value: --config, --update\n",
      );
      expect(resolveCliMissingValueError({ config: "path", public: true })).toBeNull();
      expect(resolveCliMissingValueError({})).toBeNull();
    });
  });

  describe("share export gist-only flags", () => {
    test("share export rejects --public", () => {
      const res = runCli(["share", "export", "--public"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Option(s) only valid for share gist: --public");
    });

    test("share export rejects --gist-id and --renderer-url together", () => {
      const res = runCli(["share", "export", "--gist-id", "x", "--renderer-url", "https://r"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain(
        "Option(s) only valid for share gist: --renderer-url, --gist-id",
      );
    });
  });

  describe("serve positionals", () => {
    test("explicit serve command rejects extra positional arguments", () => {
      const res = runCli(["serve", "extra"]);
      expect(res.status).toBe(1);
      expect(res.stderr).toContain("Unknown argument: extra");
    });
  });
});
