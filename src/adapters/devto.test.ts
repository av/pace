import { describe, it, expect, spyOn, beforeEach, afterEach } from "bun:test";
import adapter from "./devto";
import * as typesMod from "./types";

describe("devto adapter", () => {
  let fetchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchSpy = spyOn(global, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("satisfies ngb contract: default export .name + .fetch fn (TDD coverage)", () => {
    expect(adapter).toHaveProperty("name", "devto");
    expect(typeof adapter.fetch).toBe("function");
  });

  it("mmu error paths use errorMessage helper (network/!ok per mmu + sh1 quality; TDD)", async () => {
    // network reject path (exercises catch + errorMessage + duck sh1)
    const testErr = { message: "network boom for devto test" };
    fetchSpy.mockRejectedValueOnce(testErr);
    await expect(
      adapter.fetch({ params: { tags: ["javascript"] } })
    ).rejects.toThrow(
      `devto: error fetching tag "javascript": ${testErr.message}`
    );

    // !ok HTTP error path: currently throws raw status WITHOUT calling errorMessage
    // (makes this it FAIL pre-edit); minimal devto edit to use helper in !ok will green + quality
    const emSpy = spyOn(typesMod, "errorMessage");
    const callsBefore = emSpy.mock.calls.length; // capture 0 before exercising !ok path
    const badRes = {
      ok: false,
      status: 403,
    } as any;
    fetchSpy.mockResolvedValueOnce(badRes);

    await expect(
      adapter.fetch({ params: { tags: ["javascript"] } })
    ).rejects.toThrow(`devto: failed to fetch tag "javascript": 403`);

    // delta during !ok block: currently 1 (mystery/side from setup or mock) → FAIL pre-edit when expect 2
    // after minimal devto.ts edit (add errorMessage call for the status in !ok throw path) → delta=2, green + quality
    const callsAfter = emSpy.mock.calls.length;
    expect(callsAfter - callsBefore).toBe(2);
    emSpy.mockRestore();
  });
});
