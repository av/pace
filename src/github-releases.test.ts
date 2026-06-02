import { describe, test, expect, spyOn } from "bun:test";
import githubReleasesAdapter from "./adapters/github-releases";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const githubReleasesCfg = (params: Record<string, unknown> = {}) =>
  adapterCfg("github-releases", params);

describe("github-releases", () => {
  test("ngb contract", () => {
    expect(githubReleasesAdapter.name).toBe("github-releases");
    expect(typeof githubReleasesAdapter.fetch).toBe("function");
  });

  test("returns [] and no fetch when no repos configured", async () => {
    const items = await githubReleasesAdapter.fetch(githubReleasesCfg({ repos: [] }));
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("github-releases: no repos configured");
  });

  test("returns [] and no fetch when repos are only blank strings", async () => {
    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["", "  "] }),
    );
    expect(items).toEqual([]);
    expect(mocks.fetchMock).not.toHaveBeenCalled();
    expect(mocks.warnSpy).toHaveBeenCalledWith("github-releases: no repos configured");
  });

  test("includes repo tagline in release title from api.github.com/repos", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
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

  test("decodes HTML entities in release names from API", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/releases?")) {
        return new Response(
          JSON.stringify([
            {
              id: 2,
              tag_name: "v2.0.0",
              name: "A &amp; B &#8364; C",
              html_url: "https://github.com/o/r/releases/tag/v2.0.0",
              body: null,
              published_at: "2024-02-01T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("api.github.com/repos/o/r")) {
        return new Response(JSON.stringify({ description: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${u}`);
    });

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: A & B € C");
  });

  test("decodes HTML entities in tag_name when name is null", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/releases?")) {
        return new Response(
          JSON.stringify([
            {
              id: 3,
              tag_name: "v&amp;3",
              name: null,
              html_url: "https://github.com/o/r/releases/tag/v%263",
              body: null,
              published_at: "2024-03-01T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("api.github.com/repos/o/r")) {
        return new Response(JSON.stringify({ description: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected url: ${u}`);
    });

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: v&3");
  });

  test("omits Authorization when token is blank or whitespace-only", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/releases?")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              tag_name: "v1.0.0",
              name: "One",
              html_url: "https://github.com/o/r/releases/tag/v1.0.0",
              body: null,
              published_at: "2024-01-01T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("api.github.com/repos/o/r")) {
        return new Response(JSON.stringify({ description: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected url: ${u}`);
    });

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], token: "   " }),
    );

    const apiCalls = mocks.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.github.com"),
    );
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const [, init] of apiCalls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
  });

  test("trims configured token for GitHub API Authorization header", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      const u = String(url);
      if (u.includes("/releases?")) {
        return new Response(
          JSON.stringify([
            {
              id: 1,
              tag_name: "v1.0.0",
              name: "One",
              html_url: "https://github.com/o/r/releases/tag/v1.0.0",
              body: null,
              published_at: "2024-01-01T00:00:00Z",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (u.includes("api.github.com/repos/o/r")) {
        return new Response(JSON.stringify({ description: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected url: ${u}`);
    });

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], token: "  ghp_test  " }),
    );

    const apiCalls = mocks.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("api.github.com"),
    );
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const [, init] of apiCalls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer ghp_test");
    }
  });

  test("errorMessage on !ok", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    const callsBefore = emSpy.mock.calls.length;
    mocks.fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));

    await expect(
      githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["missing/repo"] })),
    ).rejects.toThrow(/^github-releases: failed to fetch missing\/repo: HTTP error 404$/);

    expect(emSpy.mock.calls.length - callsBefore).toBe(1);
    emSpy.mockRestore();
  });
});