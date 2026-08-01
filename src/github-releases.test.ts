import { describe, test, expect } from "bun:test";
import { githubReleasesAdapter } from "./adapters/github-shared";
import { makeErrorResponse, makeJsonResponse } from "./test/fetch-responses";
import { invalidLimitParams } from "./test/invalid-params";
import { expectAdapterFetchError, fetchMockCalls, useFetchMockSuite } from "./test/adapter-mocks";
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

  test("falls back to current time for unparseable published_at instead of an Invalid Date", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [makeGitHubRelease({ published_at: "not-a-date" })],
      }),
    );

    const before = Date.now();
    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(Number.isNaN(items[0].timestamp.getTime())).toBe(false);
    expect(items[0].timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      'dates: invalid feed date "not-a-date", using current time',
    );
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
    expect(apiCalls).toHaveLength(2); // releases endpoint + repo meta
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
    expect(apiCalls).toHaveLength(2); // releases endpoint + repo meta
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

  test("dedupes duplicate release urls when the same repo is listed twice", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [
          makeGitHubRelease({ id: 1, name: "One" }),
          makeGitHubRelease({
            id: 2,
            tag_name: "v2.0.0",
            name: "Two",
            html_url: "https://github.com/o/r/releases/tag/v2.0.0",
            published_at: "2024-02-01T00:00:00Z",
          }),
        ],
      }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r", "o/r"], limit: 10 }),
    );

    expect(githubReleasesFetchCalls().length).toBe(4);
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.url)).toEqual([
      "https://github.com/o/r/releases/tag/v2.0.0",
      "https://github.com/o/r/releases/tag/v1.0.0",
    ]);
  });

  test("caps mapped items when API returns more releases than per_page limit", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, {
        releases: [
          makeGitHubRelease({ id: 1, name: "One" }),
          makeGitHubRelease({
            id: 2,
            tag_name: "v2.0.0",
            name: "Two",
            html_url: "https://github.com/o/r/releases/tag/v2.0.0",
            published_at: "2024-02-01T00:00:00Z",
          }),
          makeGitHubRelease({
            id: 3,
            tag_name: "v3.0.0",
            name: "Three",
            html_url: "https://github.com/o/r/releases/tag/v3.0.0",
            published_at: "2024-03-01T00:00:00Z",
          }),
        ],
      }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], limit: 2 }),
    );

    expect(releasesApiUrl()).toContain("per_page=2");
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.id).sort()).toEqual(["github:o/r:1", "github:o/r:2"]);
    expect(items.some((item) => item.id === "github:o/r:3")).toBe(false);
  });

  test("caps limit at 30 in per_page query param", async () => {
    mockReleasesAndRepoMeta();

    await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"], limit: 200 }),
    );

    expect(releasesApiUrl()).toContain("per_page=30");
  });

  test("errorMessage on !ok", async () => {
    await expectAdapterFetchError(
      mocks.fetchMock,
      {
        httpStatus: 404,
        fetch: () =>
          githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["missing/repo"] })),
        throwMatcher: /^github-releases: failed to fetch missing\/repo: HTTP error 404$/,
      },
    );
  });

  test("warns and returns [] when releases API response is not a JSON array", async () => {
    mocks.fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/releases?")) {
        return makeJsonResponse({ error: "unexpected shape" });
      }
      return githubReleasesApiFetchMock(url, { description: "A cool repo" });
    });

    const items = await githubReleasesAdapter.fetch(githubReleasesCfg({ repos: ["o/r"] }));

    expect(items).toEqual([]);
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "github-releases: expected JSON array for o/r (got object), treating as empty",
    );
  });
});

describe("github-releases malformed API payloads", () => {
  test("skips malformed release elements instead of crashing the fetch", async () => {
    const malformed = [
      null,
      "junk",
      {},
      { tag_name: "v9.9.9" },
      makeGitHubRelease(),
    ] as unknown as ReturnType<typeof makeGitHubRelease>[];
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, { releases: malformed }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("github:o/r:1");
    expect(mocks.warnSpy).toHaveBeenCalledWith(
      "github-releases: skipped 4 invalid element(s) in o/r (5 total; required: id)",
    );
  });

  test("degrades gracefully when a release has only an id", async () => {
    const bare = [{ id: 77 }] as unknown as ReturnType<typeof makeGitHubRelease>[];
    mocks.fetchMock.mockImplementation(async (url: string) =>
      githubReleasesApiFetchMock(url, { releases: bare }),
    );

    const items = await githubReleasesAdapter.fetch(
      githubReleasesCfg({ repos: ["o/r"] }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("github:o/r:77");
    expect(items[0].url).toBe("https://github.com/o/r/releases");
    expect(items[0].title).toBe("o/r: (untitled release)");
    expect(Number.isNaN(items[0].timestamp.getTime())).toBe(false);
  });
});
