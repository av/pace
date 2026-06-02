import { describe, expect, it, test } from "bun:test";
import adapter, { decodeTweetTitle } from "./adapters/twitter";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const twitterCfg = (params: Record<string, unknown> = {}) => adapterCfg("twitter", params);

describe("twitter", () => {
  test("ngb contract", () => {
    expect(adapter.name).toBe("twitter");
    expect(typeof adapter.fetch).toBe("function");
  });

  test("decodes HTML entities in tweet titles for API parity", () => {
    expect(decodeTweetTitle("A &amp; B &#8364; C")).toBe("A & B € C");
    expect(decodeTweetTitle()).toBe("(untitled)");
  });

  it("returns [] and warns configured message when lists provided", async () => {
    const items = await adapter.fetch(twitterCfg({ lists: ["u1", "u2"] }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "twitter: adapter configured with 2 source(s); Twitter API requires params.bearer_token. Returning empty results.",
    );
  });

  it("returns [] and warns configured message when searches provided", async () => {
    const items = await adapter.fetch(twitterCfg({ searches: ["foo"] }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "twitter: adapter configured with 1 source(s); Twitter API requires params.bearer_token. Returning empty results.",
    );
  });

  it("returns [] and warns no-config message when neither lists nor searches", async () => {
    const items = await adapter.fetch(twitterCfg({}));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "twitter: no lists or searches configured; Twitter API requires params.bearer_token. Returning empty results.",
    );
  });

  it("returns [] and warns no-config message when no params at all", async () => {
    const items = await adapter.fetch(adapterCfg("twitter"));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "twitter: no lists or searches configured; Twitter API requires params.bearer_token. Returning empty results.",
    );
  });

  it("prefers lists over searches when both present", async () => {
    const items = await adapter.fetch(twitterCfg({ lists: ["l"], searches: ["s"] }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy.mock.calls[0][0]).toContain("configured with 1 source(s)");
  });
});