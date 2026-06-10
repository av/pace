import { describe, test, expect } from "bun:test";
import {
  isExtensionAdapterSourceFile,
  isValidAdapter,
  parseReaddirEntry,
} from "./adapter-discovery";
import { ADAPTER_TYPES } from "./params";

describe("parseReaddirEntry", () => {
  test("string entry treated as file", () => {
    expect(parseReaddirEntry("custom-adapter.ts")).toEqual({
      file: "custom-adapter.ts",
      isFile: true,
    });
  });

  test("valid Dirent returns name and isFile result", () => {
    const entry = {
      name: "custom-adapter.ts",
      isFile: () => true,
      isDirectory: () => false,
    };
    expect(parseReaddirEntry(entry)).toEqual({
      file: "custom-adapter.ts",
      isFile: true,
    });
  });

  test.each([42, null, { foo: "no-name-or-isfile" }, { name: "x.ts" }])(
    "corrupt entry %j returns null",
    (entry) => {
      expect(parseReaddirEntry(entry as never)).toBeNull();
    },
  );
});

describe("isExtensionAdapterSourceFile", () => {
  test("accepts custom extension adapter filenames", () => {
    expect(isExtensionAdapterSourceFile("my-custom-feed.ts")).toBe(true);
  });

  test.each([
    ".dot-hidden.ts",
    "types.ts",
    "index.ts",
    "adapter-registry.ts",
    "foo.test.ts",
    "foo.d.ts",
    "bar.js",
    "subdir",
    ...ADAPTER_TYPES.map((type) => `${type}.ts`),
  ])("rejects support/builtin filename %s", (name) => {
    expect(isExtensionAdapterSourceFile(name)).toBe(false);
  });
});

describe("isValidAdapter", () => {
  const fetch = async () => [];

  test("accepts plain object with trimmed name and fetch", () => {
    expect(isValidAdapter({ name: "good", fetch })).toBe(true);
  });

  test.each([
    null,
    undefined,
    "bad",
    { name: "good" },
    { fetch },
    { name: 123, fetch },
    { name: "   ", fetch },
    { name: " spaced ", fetch },
    Object.create({ name: "proto", fetch }),
  ])("rejects invalid adapter shape %j", (adapter) => {
    expect(isValidAdapter(adapter)).toBe(false);
  });
});