import { describe, test, expect, spyOn, afterEach } from "bun:test";
import {
  formatGitHubReleaseDisplayTitle,
  resolveGitHubRepos,
} from "./adapters/github-shared";

describe("github-shared", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    warnSpy?.mockRestore();
  });

  test("resolveGitHubRepos returns null and warns when repos missing or blank", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveGitHubRepos({}, "github-releases")).toBeNull();
    expect(resolveGitHubRepos({ repos: ["", "  "] }, "github")).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith("github-releases: no repos configured");
    expect(warnSpy).toHaveBeenCalledWith("github: no repos configured");
  });

  test("resolveGitHubRepos trims repos and token", () => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const resolved = resolveGitHubRepos(
      { repos: ["  o/r  ", ""], token: "  ghp_x  " },
      "github-releases",
    );

    expect(resolved).toEqual({ repos: ["o/r"], token: "ghp_x" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("formatGitHubReleaseDisplayTitle decodes entities and appends tagline", () => {
    const title = formatGitHubReleaseDisplayTitle(
      "o/r",
      { tag: "v1.0.0", title: "Rock &amp; Roll" },
      "A cool repo",
    );

    expect(title).toBe("o/r: v1.0.0 | Rock & Roll | A cool repo");
  });

  test("formatGitHubReleaseDisplayTitle omits duplicate tag when title matches tag", () => {
    const title = formatGitHubReleaseDisplayTitle(
      "o/r",
      { tag: "v1.0.0", title: "v1.0.0" },
      "",
    );

    expect(title).toBe("o/r: v1.0.0");
  });

  test("formatGitHubReleaseDisplayTitle uses title only when tag absent", () => {
    const title = formatGitHubReleaseDisplayTitle(
      "o/r",
      { title: "A &amp; B" },
      "desc",
    );

    expect(title).toBe("o/r: A & B | desc");
  });
});