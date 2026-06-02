import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import githubReleasesAdapter from "./adapters/github-releases";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

describe("github-releases adapter", () => {
  let fetchMock: ReturnType<typeof mock>;

  test("satisfies ngb contract: default export has .name and .fetch", () => {
    expect(githubReleasesAdapter.name).toBe("github-releases");
    expect(typeof githubReleasesAdapter.fetch).toBe("function");
  });

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("uses errorMessage helper in !ok HTTP error path", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    const callsBefore = emSpy.mock.calls.length;
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      githubReleasesAdapter.fetch({ params: { repos: ["missing/repo"] } } as any),
    ).rejects.toThrow("github-releases: failed to fetch missing/repo: 404");

    expect(emSpy.mock.calls.length - callsBefore).toBe(2);
    emSpy.mockRestore();
  });
});