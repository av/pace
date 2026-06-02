import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import githubReleasesAdapter from "./adapters/github-releases";
import type { AdapterConfig } from "./adapters/types";
import * as typesMod from "./adapters/types";

const originalFetch = globalThis.fetch;

const defaultCfg: AdapterConfig = { type: "github-releases" };

function githubReleasesCfg(params: Record<string, unknown> = {}): AdapterConfig {
  return { ...defaultCfg, params };
}

describe("github-releases", () => {
  let fetchMock: ReturnType<typeof mock>;

  test("ngb contract", () => {
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

  test("includes repo tagline in release title from api.github.com/repos", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/releases?")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              tag_name: "v1.0.0",
              name: "One",
              html_url: "https://github.com/o/r/releases/tag/v1.0.0",
              body: "Release notes here",
              published_at: "2024-01-01T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("api.github.com/repos/o/r")) {
        return new Response(JSON.stringify({ description: "A cool repo" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected url: ${u}`);
    });

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: One | A cool repo");
    expect(items[0].body).toBe("Release notes here");
  });

  test("errorMessage on !ok", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    const callsBefore = emSpy.mock.calls.length;
    fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["missing/repo"] })),
    ).rejects.toThrow(/^github-releases: failed to fetch missing\/repo: HTTP error 404$/);

    expect(emSpy.mock.calls.length - callsBefore).toBe(1);
    emSpy.mockRestore();
  });
});