import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { runCli } from "./test/cli-runner";
import { ADAPTER_TYPES } from "./adapters/params";
import { TRANSFORM_TYPES } from "./transform-schema";

describe("pace adapters list", () => {
  test("output contains all adapter types", () => {
    const result = runCli(["adapters", "list"]);
    expect(result.status).toBe(0);
    for (const type of ADAPTER_TYPES) {
      expect(result.stdout).toContain(type);
    }
  });

  test("each line has a - separator", () => {
    const result = runCli(["adapters", "list"]);
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split("\n");
    for (const line of lines) {
      expect(line).toContain(" - ");
    }
  });
});

describe("pace adapters explain", () => {
  test("explain reddit contains param table rows", () => {
    const result = runCli(["adapters", "explain", "reddit"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("adapter: reddit");
    expect(result.stdout).toContain("subreddits");
    expect(result.stdout).toContain("sort");
    expect(result.stdout).toContain("limit");
    expect(result.stdout).toContain("common to all adapters");
  });

  test("footer mentions refresh_interval is clamped at runtime", () => {
    const result = runCli(["adapters", "explain", "hackernews"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("clamped at runtime");
  });

  test("explain shows example YAML block", () => {
    const result = runCli(["adapters", "explain", "hackernews"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("example:");
    expect(result.stdout).toContain("type: hackernews");
  });

  test("unknown adapter type exits 1 with error and available list", () => {
    const result = runCli(["adapters", "explain", "bogus-adapter"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown adapter type "bogus-adapter"');
    expect(result.stderr).toContain("Available:");
    expect(result.stderr).toContain("hackernews");
  });
});

describe("pace transforms list", () => {
  test("output contains all transform types", () => {
    const result = runCli(["transforms", "list"]);
    expect(result.status).toBe(0);
    for (const type of TRANSFORM_TYPES) {
      expect(result.stdout).toContain(type);
    }
  });
});

describe("pace transforms explain", () => {
  test("explain dedupe contains param table rows", () => {
    const result = runCli(["transforms", "explain", "dedupe"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("transform: dedupe");
    expect(result.stdout).toContain("strategy");
    expect(result.stdout).toContain("threshold");
  });

  test("explain llm-summarize includes note", () => {
    const result = runCli(["transforms", "explain", "llm-summarize"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Degrades to pass-through");
  });

  test("unknown transform type exits 1 with error and available list", () => {
    const result = runCli(["transforms", "explain", "bogus-transform"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown transform type "bogus-transform"');
    expect(result.stderr).toContain("Available:");
    expect(result.stderr).toContain("latest");
  });
});

describe("pace config check", () => {
  test("exits 0 and prints summary for config.example.yaml", () => {
    const result = runCli(["config", "check", "config.example.yaml"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("config OK:");
    expect(result.stdout).toContain("adapters");
    expect(result.stdout).toContain("pipelines");
    expect(result.stdout).toContain("panels");
  });

  test("accepts --config flag and validates the specified file", () => {
    const result = runCli(["config", "check", "--config", "config.example.yaml"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("config OK:");
  });

  test("positional path takes priority over --config flag", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-config-test-"));
    const goodPath = join(dir, "good.yaml");
    const badPath = join(dir, "bad.yaml");
    try {
      writeFileSync(goodPath, "adapters:\n  - type: hackernews\n");
      writeFileSync(badPath, "adapters: [\ninvalid yaml {{{");
      // positional (good) should win over --config (bad)
      const result = runCli(["config", "check", goodPath, "--config", badPath]);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("config OK:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("config check with no layout uses DEFAULT_LAYOUT and reports non-zero panel count", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-config-test-"));
    const cfgPath = join(dir, "no-layout.yaml");
    try {
      writeFileSync(cfgPath, "adapters:\n  - type: hackernews\n");
      const result = runCli(["config", "check", cfgPath]);
      expect(result.status).toBe(0);
      // DEFAULT_LAYOUT has one panel so count should be 1, not 0
      expect(result.stdout).toContain("1 panels");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("exits 1 for a broken config fixture", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-config-test-"));
    const brokenPath = join(dir, "broken.yaml");
    try {
      // layout direction validation error
      writeFileSync(
        brokenPath,
        `adapters:
  - type: hackernews
layout:
  direction: invalid-direction
  children: []
`,
      );
      const result = runCli(["config", "check", brokenPath]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("config:");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  test("exits 1 for invalid YAML syntax", () => {
    const dir = mkdtempSync(join(os.tmpdir(), "pace-config-test-"));
    const badPath = join(dir, "bad.yaml");
    try {
      writeFileSync(badPath, "adapters: [\ninvalid yaml {{{");
      const result = runCli(["config", "check", badPath]);
      expect(result.status).toBe(1);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
