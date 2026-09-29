import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ADAPTER_TYPES } from "./adapters/params";
import { TRANSFORM_TYPES } from "./transform-schema";
import { HELP_ROWS } from "./dashboard.js";

const ROOT = join(import.meta.dir, "..");
// The reference tables moved from README.md into docs/; these guards follow them there.
const doc = (path: string) => readFileSync(join(ROOT, path), "utf-8");
const presetsDoc = doc("docs/presets.md");
const configDoc = doc("docs/configuration.md");
const dashboardDoc = doc("docs/dashboard.md");

const ACTUAL_PRESETS = readdirSync(join(ROOT, "presets"))
  .filter((f) => /^config\..+\.yaml$/.test(f))
  .map((f) => f.replace(/^config\./, "").replace(/\.yaml$/, ""))
  .sort();

describe("readme-sync: presets", () => {
  test("preset table lists exactly the bundled presets", () => {
    const section = presetsDoc.slice(
      presetsDoc.indexOf("Available presets:"),
      presetsDoc.indexOf("List presets:"),
    );
    const listed = [...section.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual(ACTUAL_PRESETS);
  });

  test("preset image/config links reference existing preset files", () => {
    const refs = [...presetsDoc.matchAll(/\.\/presets\/config\.([\w-]+)\.yaml/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of new Set(refs)) {
      expect(ACTUAL_PRESETS).toContain(ref);
    }
  });
});

describe("readme-sync: adapters", () => {
  test("adapter count and list match the adapter registry", () => {
    const m = /Pace ships with (\d+) adapters: (.+?)\./s.exec(configDoc);
    expect(m, "docs/configuration.md has the 'Pace ships with N adapters' sentence").not.toBeNull();
    const claimedCount = Number(m![1]);
    const claimedTypes = [...m![2]!.matchAll(/`([\w-]+)`/g)].map((x) => x[1]!).sort();
    expect(claimedCount).toBe(ADAPTER_TYPES.length);
    expect(claimedTypes).toEqual([...ADAPTER_TYPES].sort());
  });
});

describe("readme-sync: keyboard navigation", () => {
  test("keyboard table lists exactly the help-overlay key rows, in order", () => {
    const start = dashboardDoc.indexOf("## Keyboard Navigation");
    expect(start, "docs/dashboard.md has a '## Keyboard Navigation' section").toBeGreaterThan(-1);
    const section = dashboardDoc.slice(start);
    const listed = [...section.matchAll(/^\| `(.+?)` \|/gm)].map((m) => m[1]!);
    expect(listed).toEqual(HELP_ROWS.map((r) => r[0]));
  });
});

describe("readme-sync: transforms", () => {
  test("transform table lists exactly the registered transform types", () => {
    const section = configDoc.slice(configDoc.indexOf("## Transforms"), configDoc.indexOf("## Pipelines"));
    const listed = [...section.matchAll(/^\| `([\w-]+)` \|/gm)].map((m) => m[1]!).sort();
    expect(listed).toEqual([...TRANSFORM_TYPES].sort());
  });
});
