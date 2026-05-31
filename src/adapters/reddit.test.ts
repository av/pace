import { describe, it, expect, spyOn } from "bun:test";
import redditAdapter from "./reddit";
import * as typesMod from "./types";

describe("adapters/reddit", () => {
  it("satisfies ngb contract (default export .name + .fetch fn)", () => {
    expect(redditAdapter).toBeDefined();
    expect(redditAdapter.name).toBe("reddit");
    expect(typeof redditAdapter.fetch).toBe("function");
  });

  it("uses errorMessage(err) in mmu !ok error path (per contract + sh1 quality)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    const fetchMock = spyOn(globalThis, "fetch" as any).mockResolvedValue({
      ok: false,
      status: 404,
    } as any);

    const config = {
      params: {
        subreddits: ["test"],
      },
    } as any;

    await expect(redditAdapter.fetch(config)).rejects.toThrow(/reddit: error fetching/);

    const hasStatusObjCall = emSpy.mock.calls.some((call: any[]) => {
      const arg = call[0];
      return arg && typeof arg === "object" && arg !== null && "message" in arg && String((arg as any).message) === "404";
    });
    expect(hasStatusObjCall).toBe(true);

    emSpy.mockRestore();
    fetchMock.mockRestore();
  });
});
