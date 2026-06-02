import { afterEach, beforeEach, describe, expect, it, spyOn, test } from "bun:test";
import adapter from "./adapters/twitter";

describe("twitter adapter", () => {
  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(adapter.name).toBe("twitter");
    expect(typeof adapter.fetch).toBe("function");
  });

  let logSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    logSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("returns [] and warns configured message when lists provided", async () => {
    const items = await adapter.fetch({ params: { lists: ["u1", "u2"] } } as any);
    expect(items).toEqual([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'twitter: adapter configured with 2 source(s), but Twitter API requires API credentials. Set params.bearer_token to enable. Returning empty results.',
    );
  });

  it("returns [] and warns configured message when searches provided", async () => {
    const items = await adapter.fetch({ params: { searches: ["foo"] } } as any);
    expect(items).toEqual([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'twitter: adapter configured with 1 source(s), but Twitter API requires API credentials. Set params.bearer_token to enable. Returning empty results.',
    );
  });

  it("returns [] and warns no-config message when neither lists nor searches", async () => {
    const items = await adapter.fetch({ params: {} } as any);
    expect(items).toEqual([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results.",
    );
  });

  it("returns [] and warns no-config message when no params at all", async () => {
    const items = await adapter.fetch({} as any);
    expect(items).toEqual([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "twitter: no lists or searches configured, and Twitter API requires credentials. Returning empty results.",
    );
  });

  it("prefers lists over searches when both present", async () => {
    const items = await adapter.fetch({ params: { lists: ["l"], searches: ["s"] } } as any);
    expect(items).toEqual([]);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain("configured with 1 source(s)");
  });
});
