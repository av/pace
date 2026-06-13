import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { ADAPTER_TYPES } from "./adapters/params";
import { TRANSFORM_TYPES } from "./transform-schema";

const skillPath = join(import.meta.dir, "../skills/pace-dashboard-configure/SKILL.md");
const skillContent = readFileSync(skillPath, "utf-8");

describe("skills-sync: pace-dashboard-configure coverage", () => {
  describe("adapter types", () => {
    for (const type of ADAPTER_TYPES) {
      test(`has ### ${type} heading`, () => {
        expect(skillContent).toContain(`### ${type}`);
      });
    }
  });

  describe("transform types", () => {
    for (const type of TRANSFORM_TYPES) {
      test(`has ### ${type} heading or type: ${type} reference`, () => {
        const hasHeading = skillContent.includes(`### ${type}`);
        const hasTypeRef = skillContent.includes(`type: ${type}`);
        expect(hasHeading || hasTypeRef).toBe(true);
      });
    }
  });
});
