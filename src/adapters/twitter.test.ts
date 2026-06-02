import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import adapter from "./twitter";

describe("adapters/twitter", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("satisfies ngb contract (default export .name + .fetch fn, discoverable via index)", () => {
    expect(adapter).toHaveProperty("name", "twitter");
    expect(typeof adapter.fetch).toBe("function");
  });

  it("warns with direct message strings and returns [] for configured/no-source cases", async () => {
    const configWithLists = { type: "twitter", params: { lists: ["foo"] } } as any;
    const res1 = await adapter.fetch(configWithLists);
    expect(res1).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "twitter: adapter configured with 1 source(s), but Twitter API requires API credentials. Set params.bearer_token to enable. Returning empty results.",
    );

    warnSpy.mockClear();
    const configNoSources = { type: "twitter" } as any;
    const res2 = await adapter.fetch(configNoSources);
    expect(res2).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results.",
    );
  });
});