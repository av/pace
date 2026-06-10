import { describe, test, expect } from "bun:test";
import githubReleasesAdapter from "./adapters/github-releases";
import { makeErrorResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import { fetchMockCalls, useFetchMockSuite, withErrorMessageSpy } from "./test/adapter-mocks";
import { githubReleasesCfg } from "./test/adapter-cfg";
import {
  githubReleasesApiFetchMock,
  makeGitHubRelease,
} from "./test/github-releases-fixtures";

const mocks = useFetchMockSuite();

const githubReleasesFetchCalls = () => fetchMockCalls(mocks.fetchMock);
const releasesApiUrl = () =>
  githubReleasesFetchCalls().find((c) => c.url.includes("/releases?"))?.url ?? "";

describe("github-releases", () => {
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
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [makeGitHubRelease({ body: "Release notes here" })],
        description: "A cool repo",
      }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: One | A cool repo");
    expect(items[0].body).toBe("Release notes here");
  });

  test("decodes HTML entities in release names from API", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [
          makeGitHubRelease({
            id: 2,
            tag_name: "v2.0.0",
            name: "A &amp; B &#8364; C",
            html_url: "https://github.com/o/r/releases/tag/v2.0.0",
            published_at: "2024-02-01T00:00:00Z",
          }),
        ],
      }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: A & B € C");
  });

  test("decodes HTML entities in tag_name when name is null", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [
          makeGitHubRelease({
            id: 3,
            tag_name: "v&amp;3",
            name: null,
            html_url: "https://github.com/o/r/releases/tag/v%263",
            published_at: "2024-03-01T00:00:00Z",
          }),
        ],
      }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("o/r: v&3");
  });

  test("omits Authorization when token is blank or whitespace-only", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [makeGitHubRelease()],
      }),
    );

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], token: "   " }),
    );

    const apiCalls = githubReleasesFetchCalls().filter((c) => c.url.includes("api.github.com"));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBeUndefined();
    }
  });

  test("trims configured token for GitHub API Authorization header", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [makeGitHubRelease()],
      }),
    );

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], token: "  ghp_test  " }),
    );

    const apiCalls = githubReleasesFetchCalls().filter((c) => c.url.includes("api.github.com"));
    expect(apiCalls.length).toBeGreaterThan(0);
    for (const call of apiCalls) {
      const headers = (call.init?.headers ?? {}) as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer ghp_test");
    }
  });

  function mockReleasesAndRepoMeta() {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url),
    );
  }

  test("default per_page=5 in releases API URL", async () => {
    mockReleasesAndRepoMeta();

    await githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["o/r"] }));

    expect(releasesApiUrl()).toContain("per_page=5");
  });

  test.each(invalidLimitParams(10))(
    "invalid limit (%s) uses default per_page=5 in API URL",
    async (limit) => {
      mockReleasesAndRepoMeta();

      await githubReleasesAdapter.fetch(
        githubReleasesCfg({ repos: ["o/r"], limit }),
      );

      expect(releasesApiUrl()).toContain("per_page=5");
    },
  );

  test("floors fractional limit in per_page query param", async () => {
    mockReleasesAndRepoMeta();

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], limit: 7.9 }),
    );

    expect(releasesApiUrl()).toContain("per_page=7");
  });

  test("respects limit parameter in per_page query param", async () => {
    mockReleasesAndRepoMeta();

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], limit: 12 }),
    );

    expect(releasesApiUrl()).toContain("per_page=12");
  });

  test("caps limit at 30 in per_page query param", async () => {
    mockReleasesAndRepoMeta();

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], limit: 200 }),
    );

    expect(releasesApiUrl()).toContain("per_page=30");
  });

  test("errorMessage on !ok", async () => {
    await withErrorMessageSpy(async (emSpy) => {
      mocks.fetchMock.mockResolvedValue(makeErrorResponse(404));

      await expect(
        githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["missing/repo"] })),
      ).rejects.toThrow(/^github-releases: failed to fetch missing\/repo: HTTP error 404$/);

      expect(emSpy).toHaveBeenCalledTimes(1);
    });
  });
});