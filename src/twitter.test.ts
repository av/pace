import { describe, expect, it, test } from "bun:test";
import adapter from "./adapters/twitter";
import { useFetchMockSuite } from "./test/adapter-mocks";
import { twitterCfg } from "./test/adapter-cfg";

const mocks = useFetchMockSuite();


describe("twitter", () => {
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
    const items = await adapter.fetch(twitterCfg());
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

  it("blank-only lists fall through to searches", async () => {
    const items = await adapter.fetch(
      twitterCfg({ lists: ["", "  "], searches: ["foo"] }),
    );
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "twitter: adapter configured with 1 source(s); Twitter API requires params.bearer_token. Returning empty results.",
    );
  });

  it("trims whitespace in list entries", async () => {
    const items = await adapter.fetch(twitterCfg({ lists: ["  u1  ", "u2"] }));
    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledTimes(1);
    expect(mocks.warnSpy.mock.calls[0][0]).toContain("configured with 2 source(s)");
  });
});