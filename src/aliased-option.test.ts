import { describe, test, expect } from "bun:test";
import {
  canonicalOptionTypes,
  createAliasedResolver,
  resolveAliasedOption,
} from "./utils";

describe("resolveAliasedOption prototype safety", () => {
  const types = canonicalOptionTypes("hot", "new", "top");

  test("Object.prototype keys in types lookup fall through to fallback", () => {
    expect(resolveAliasedOption("constructor", types, {}, "hot")).toBe("hot");
    expect(resolveAliasedOption("toString", types, {}, "hot")).toBe("hot");
    expect(resolveAliasedOption("hasOwnProperty", types, {}, "hot")).toBe("hot");
    expect(resolveAliasedOption("valueOf", types, {}, "hot")).toBe("hot");
    expect(resolveAliasedOption("__proto__", types, {}, "hot")).toBe("hot");
  });

  test("Object.prototype keys in aliases lookup fall through to fallback", () => {
    const aliases = { best: "top" as const };
    expect(resolveAliasedOption("constructor", {}, aliases, "new")).toBe("new");
    expect(resolveAliasedOption("__proto__", {}, aliases, "new")).toBe("new");
    expect(resolveAliasedOption("best", {}, aliases, "new")).toBe("top");
  });

  test("null fallback is preserved for prototype-key input", () => {
    expect(resolveAliasedOption("constructor", types, {}, null)).toBeNull();
  });

  test("valid tokens still resolve case-insensitively", () => {
    expect(resolveAliasedOption("HOT", types, {}, "new")).toBe("hot");
  });

  test("createAliasedResolver resolvers reject prototype-key config tokens", () => {
    const resolve = createAliasedResolver<"hot" | "new">({
      types: ["hot", "new"],
      aliases: { fresh: "new" },
      fallback: "hot",
    });
    expect(resolve("constructor")).toBe("hot");
    expect(resolve("toString")).toBe("hot");
    expect(resolve("fresh")).toBe("new");
    expect(resolve("NEW")).toBe("new");
  });
});
