import { describe, expect, test } from "bun:test";
import { BUILTIN_ADAPTER_MODULES } from "./adapter-registry";
import { ADAPTER_TYPES } from "./params";
import type { Adapter } from "./types";

const BUILTIN_ADAPTERS: ReadonlyArray<readonly [string, Adapter]> = ADAPTER_TYPES.map(
  (type) => [type, BUILTIN_ADAPTER_MODULES[type]] as const,
);

describe("builtin adapter contract", () => {
  test("ADAPTER_PARAM_KEYS covers every built-in adapter (no config drift)", () => {
    const builtinNames = BUILTIN_ADAPTERS.map(([name]) => name).sort();
    const paramTypes = [...ADAPTER_TYPES].sort();
    expect(paramTypes).toEqual(builtinNames);
    expect(ADAPTER_TYPES).toHaveLength(BUILTIN_ADAPTERS.length);
  });

  test("each built-in adapter has trimmed name and fetch", () => {
    for (const [expectedName, adapter] of BUILTIN_ADAPTERS) {
      expect(adapter.name).toBe(expectedName);
      expect(adapter.name).toBe(adapter.name.trim());
      expect(typeof adapter.fetch).toBe("function");
    }
  });
});