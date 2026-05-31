import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import producthuntAdapter from "./producthunt";
import * as typesMod from "./types";

describe("producthunt adapter (ngb + mmu TDD coverage)", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("satisfies ngb contract: exports default with .name and .fetch function", () => {
    expect(producthuntAdapter.name).toBe("producthunt");
    expect(typeof producthuntAdapter.fetch).toBe("function");
  });

  it("uses errorMessage helper for !ok HTTP errors in feed fetch (mmu contract + sh1 duck support)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");

    // @ts-expect-error - test mock
    globalThis.fetch = async (_url: string, _init?: RequestInit) => {
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "",
      } as Response;
    };

    const beforeCount = emSpy.mock.calls.length;

    try {
      await producthuntAdapter.fetch({});
    } catch (err: any) {
      // expected: throws with producthunt: prefix
      expect(String(err.message)).toContain("producthunt:");
    }

    const calls = emSpy.mock.calls;
    const hasStatusObjCall = calls.some((c: any) => c[0] && c[0].message === "404");

    // delta may be >0 due to catch wrapper, but the key mmu quality gap is absence of direct {message} call at the !ok site (pre-edit)
    expect(hasStatusObjCall).toBe(true);

    emSpy.mockRestore();
  });
});
