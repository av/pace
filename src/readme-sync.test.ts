import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ADAPTER_TYPES } from "./adapters/params";
import { TRANSFORM_TYPES } from "./transform-schema";

const ROOT = join(import.meta.dir, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf-8");

const ACTUAL_PRESETS = readdirSync(join(ROOT, "presets"))
  .filter((f) => /^config\..+\.yaml$/.test(f))
  .map((f) => f.replace(/^config\./, "").replace(/\.yaml$/, ""))
  .sort();

describe("readme-sync: presets", () => {
  test("preset table lists exactly the bundled presets", () => {
    const section = readme.slice(
      readme.indexOf("Available presets:"),
      readme.indexOf("List presets:"),
    );
    const listed = [...section.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual(ACTUAL_PRESETS);
  });

  test("preset image/config links reference existing preset files", () => {
    const refs = [...readme.matchAll(/\.\/presets\/config\.([\w-]+)\.yaml/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(ACTUAL_PRESETS).toContain(ref);
    }
  });
});

describe("readme-sync: adapters", () => {
  test("adapter count and list match the adapter registry", () => {
    const m = /Pace ships with (\d+) adapters: (.+?)\./s.exec(readme);
    expect(m, "README has the 'Pace ships with N adapters' sentence").not.toBeNull();
    const claimedCount = Number(m![1]);
    const claimedTypes = [...m![2]!.matchAll(/`([\w-]+)`/g)].map((x) => x[1]!).sort();
    expect(claimedCount).toBe(ADAPTER_TYPES.length);
    expect(claimedTypes).toEqual([...ADAPTER_TYPES].sort());
  });
});

describe("readme-sync: transforms", () => {
  test("transform table lists exactly the registered transform types", () => {
    const section = readme.slice(readme.indexOf("## Transforms"), readme.indexOf("## Pipelines"));
    const listed = [...section.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual([...TRANSFORM_TYPES].sort());
  });
});
