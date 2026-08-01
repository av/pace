// Deployment packaging sync tests: keep the Dockerfile, .dockerignore, and
// entrypoint honest against the repo without needing Docker in the test run.
//
// These lock the invariants verified live in the packaging smoke test:
// every COPY source exists, .dockerignore never shadows a COPY source (a
// root-level ignore pattern silently produces an image missing runtime
// files), the served static assets actually live under src/ (the only app
// directory COPY'd), and the entrypoint keeps accepting the documented
// `docker run image pace <cmd>` spelling.

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BUNDLED_STATIC, DEFAULT_SRC_DIR } from "./server/static";

const repoRoot = join(import.meta.dir, "..");

function readRepoFile(name: string): string {
  return readFileSync(join(repoRoot, name), "utf-8");
}

/** COPY source paths from the Dockerfile (flags and the destination dropped). */
function dockerfileCopySources(): string[] {
  const sources: string[] = [];
  for (const line of readRepoFile("Dockerfile").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("COPY ")) continue;
    const parts = trimmed
      .slice("COPY ".length)
      .split(/\s+/)
      .filter((p) => p.length > 0 && !p.startsWith("--"));
    // Last part is the destination.
    sources.push(...parts.slice(0, -1));
  }
  return sources;
}

/** Non-comment, non-empty .dockerignore patterns. */
function dockerignorePatterns(): string[] {
  return readRepoFile(".dockerignore")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
}

/**
 * Minimal model of Docker's per-segment ignore matching, covering the
 * pattern shapes this repo uses: literal paths, trailing-slash directory
 * patterns, and root-level `*.ext` globs (which do NOT match nested files).
 */
function ignoreMatches(pattern: string, path: string): boolean {
  const cleanPattern = pattern.replace(/\/+$/, "");
  const cleanPath = path.replace(/\/+$/, "");
  const patternSegments = cleanPattern.split("/");
  const pathSegments = cleanPath.split("/");
  // A pattern matches the path itself or any parent directory of it.
  if (patternSegments.length > pathSegments.length) return false;
  return patternSegments.every((seg, i) => {
    const target = pathSegments[i] ?? "";
    if (seg === "*") return true;
    if (seg.startsWith("*.")) return target.endsWith(seg.slice(1));
    return seg === target;
  });
}

describe("Dockerfile packaging sync", () => {
  const copySources = dockerfileCopySources();

  test("Dockerfile has COPY sources", () => {
    expect(copySources.length).toBeGreaterThan(0);
  });

  test("every Dockerfile COPY source exists in the repo", () => {
    for (const source of copySources) {
      expect(existsSync(join(repoRoot, source)), `missing COPY source: ${source}`).toBe(true);
    }
  });

  test("no .dockerignore pattern shadows a Dockerfile COPY source", () => {
    const patterns = dockerignorePatterns();
    for (const source of copySources) {
      for (const pattern of patterns) {
        expect(
          ignoreMatches(pattern, source),
          `.dockerignore pattern "${pattern}" excludes COPY source "${source}"`,
        ).toBe(false);
      }
    }
  });

  test("runtime directories the CLI reads from cwd are COPY'd", () => {
    // skills/ backs `pace skill`, presets/ backs `--preset`; both resolve
    // relative to /app in the container.
    for (const dir of ["skills/", "presets/"]) {
      expect(
        copySources.some((s) => s.replace(/^\/?/, "").replace(/\/+$/, "") === dir.replace(/\/+$/, "")),
        `Dockerfile must COPY ${dir}`,
      ).toBe(true);
    }
  });

  test("served static assets live under src/ so COPY src/ ships them", () => {
    for (const asset of BUNDLED_STATIC) {
      const assetPath = join(DEFAULT_SRC_DIR, asset.file);
      expect(existsSync(assetPath), `missing static asset: ${asset.file}`).toBe(true);
      expect(assetPath.startsWith(join(repoRoot, "src"))).toBe(true);
    }
  });
});

describe("docker-entrypoint.sh", () => {
  const entrypoint = readRepoFile("docker-entrypoint.sh");

  test("strips the redundant leading pace token from container args", () => {
    // Locks the `docker run image pace <cmd>` spelling documented in the
    // README (Get Started: `docker run --rm ghcr.io/av/pace pace skill`).
    expect(entrypoint).toContain('[ "$4" = "pace" ]');
    expect(entrypoint).toContain("shift 4");
    expect(entrypoint).toContain('set -- bun run src/cli.ts "$@"');
  });

  test("entrypoint and healthcheck scripts are executable", () => {
    for (const script of ["docker-entrypoint.sh", "docker-healthcheck.sh"]) {
      const mode = statSync(join(repoRoot, script)).mode;
      expect(mode & 0o111, `${script} must be executable`).toBeGreaterThan(0);
    }
  });
});

describe("package.json bin", () => {
  test("bin entry exists and is executable", () => {
    const pkg = JSON.parse(readRepoFile("package.json")) as { bin?: Record<string, string> };
    expect(pkg.bin?.pace).toBeDefined();
    const binPath = join(repoRoot, pkg.bin!.pace!);
    expect(existsSync(binPath)).toBe(true);
    expect(statSync(binPath).mode & 0o111).toBeGreaterThan(0);
  });
});

describe("jsx pragma (foreign-cwd bun run)", () => {
  // Bun resolves tsconfig.json (and bunfig.toml) from the CURRENT WORKING
  // DIRECTORY, not from the source file's location. `bun run /abs/.../src/cli.ts`
  // from any other cwd therefore loses tsconfig's `jsxImportSource: hono/jsx`
  // and dies with "Cannot find module 'react/jsx-dev-runtime'". A per-file
  // @jsxImportSource pragma wins over both configs, making every entry path
  // cwd-independent - so every .tsx must carry it on its first line.
  test("every .tsx file starts with the hono/jsx jsxImportSource pragma", () => {
    const glob = new Bun.Glob("src/**/*.tsx");
    const files = [...glob.scanSync({ cwd: repoRoot })];
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const firstLine = readRepoFile(file).split("\n", 1)[0];
      expect(firstLine, `${file} must start with the jsx pragma`).toBe(
        "/** @jsxImportSource hono/jsx */",
      );
    }
  });
});
