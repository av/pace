import { describe, test, expect } from "bun:test";
import yaml from "js-yaml";
import { ADAPTER_DOCS } from "./adapters/adapter-docs";
import { ADAPTER_PARAM_KEYS, ADAPTER_TYPES } from "./adapters/params";
import { validateAdapterConfig } from "./config-validate";

describe("ADAPTER_DOCS parity", () => {
  test("ADAPTER_DOCS keys exactly equal ADAPTER_TYPES", () => {
    const docKeys = new Set(Object.keys(ADAPTER_DOCS));
    const typeKeys = new Set(ADAPTER_TYPES);
    for (const type of typeKeys) {
      expect(docKeys.has(type)).toBe(true);
    }
    for (const key of docKeys) {
      expect(typeKeys.has(key as never)).toBe(true);
    }
    expect(docKeys.size).toBe(typeKeys.size);
  });

  for (const type of ADAPTER_TYPES) {
    describe(`adapter: ${type}`, () => {
      const doc = ADAPTER_DOCS[type];

      test("documented param names exactly equal ADAPTER_PARAM_KEYS[type]", () => {
        const docParams = new Set(Object.keys(doc.params));
        const schemaParams = new Set(ADAPTER_PARAM_KEYS[type]);
        for (const param of schemaParams) {
          expect(docParams.has(param)).toBe(true);
        }
        for (const param of docParams) {
          expect(schemaParams.has(param as never)).toBe(true);
        }
        expect(docParams.size).toBe(schemaParams.size);
      });

      test("every param has a non-empty description", () => {
        for (const [param, pdoc] of Object.entries(doc.params)) {
          expect(pdoc.description.trim().length).toBeGreaterThan(0);
        }
      });

      test("example parses as YAML", () => {
        expect(() => yaml.load(doc.example)).not.toThrow();
      });

      test("example passes adapter config validation", () => {
        const parsed = yaml.load(doc.example);
        expect(() => validateAdapterConfig(parsed, 0)).not.toThrow();
      });
    });
  }
});
