import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import adapter from "./github-releases";
import * as typesMod from "./types";

const originalFetch = globalThis.fetch;

describe("github-releases adapter (TDD ngb + mmu)", () => {
  let fetchMock: ReturnType<typeof mock>;
  let emSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    emSpy = spyOn(typesMod, "errorMessage");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (emSpy) emSpy.mockRestore();
    mock.restore();
  });

  it("satisfies ngb contract (default export .name + .fetch fn)", () => {
    expect(adapter.name).toBe("github-releases");
    expect(typeof adapter.fetch).toBe("function");
  });

  it("uses errorMessage(err) per mmu in error paths incl !ok status (delta calls=2 after edit)", async () => {
    const callsBefore = emSpy.mock.calls.length;
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      adapter.fetch({ params: { repos: ["missing/repo"] } } as any),
    ).rejects.toThrow("github-releases: failed to fetch missing/repo: 404");

    const delta = emSpy.mock.calls.length - callsBefore;
    expect(delta).toBe(2); // pre-edit: only catch calls it (1); post !ok edit using helper for status: 2
  });
});
