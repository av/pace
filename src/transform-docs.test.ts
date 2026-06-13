import { describe, test, expect } from "bun:test";
import yaml from "js-yaml";
import { TRANSFORM_DOCS } from "./transform-docs";
import { TRANSFORM_FIELD_KEYS, TRANSFORM_TYPES } from "./transform-schema";
import { validateTransforms } from "./transform-validate";

describe("TRANSFORM_DOCS parity", () => {
  test("TRANSFORM_DOCS keys exactly equal TRANSFORM_TYPES", () => {
    const docKeys = new Set(Object.keys(TRANSFORM_DOCS));
    const typeKeys = new Set(TRANSFORM_TYPES);
    for (const type of typeKeys) {
      expect(docKeys.has(type)).toBe(true);
    }
    for (const key of docKeys) {
      expect(typeKeys.has(key as never)).toBe(true);
    }
    expect(docKeys.size).toBe(typeKeys.size);
  });

  for (const type of TRANSFORM_TYPES) {
    describe(`transform: ${type}`, () => {
      const doc = TRANSFORM_DOCS[type];

      test("documented param names exactly equal TRANSFORM_FIELD_KEYS[type]", () => {
        const docParams = new Set(Object.keys(doc.params));
        const schemaParams = new Set(TRANSFORM_FIELD_KEYS[type]);
        for (const param of schemaParams) {
          expect(docParams.has(param)).toBe(true);
        }
        for (const param of docParams) {
          expect(schemaParams.has(param as never)).toBe(true);
        }
        expect(docParams.size).toBe(schemaParams.size);
      });

      test("every param has a non-empty description", () => {
        for (const [_param, pdoc] of Object.entries(doc.params)) {
          expect(pdoc.description.trim().length).toBeGreaterThan(0);
        }
      });

      test("example parses as YAML", () => {
        expect(() => yaml.load(doc.example)).not.toThrow();
      });

      test("example passes transform validation", () => {
        const parsed = yaml.load(doc.example);
        expect(() => validateTransforms([parsed], "transforms")).not.toThrow();
      });
    });
  }
});
