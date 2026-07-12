import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { fetchText } from "./adapters/fetch";
import { validateSafeUrl } from "./config-validate";

describe("URL credential diagnostics", () => {
  afterEach(() => {
    spyOn(globalThis, "fetch").mockRestore();
  });

  test("safe URL validation rejects userinfo without echoing credentials", () => {
    let message = "";
    try {
      validateSafeUrl("https://metrics-user:metrics-password@example.com/api", "counter.url");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toBe("config: counter.url must not include URL username or password");
    expect(message).not.toContain("metrics-user");
    expect(message).not.toContain("metrics-password");
  });

  test("runtime fetch errors redact userinfo and retain useful URL detail", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const url = "https://feed-user:feed-password@example.com/private/feed.xml?region=eu";

    await expect(fetchText("rss", url)).rejects.toThrow(
      "rss: failed to fetch https://[REDACTED]@example.com/private/feed.xml?region=eu: HTTP error 503",
    );
  });

  test("GitHub repo diagnostic context redacts credential-like URL fragments", async () => {
    spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("bad request", { status: 400 }),
    );
    const repo = "everlier/missing#access_token=fragment-secret&view=releases";
    const url = `https://api.github.com/repos/${repo}/releases?per_page=1`;

    await expect(fetchText("github-releases", url, repo)).rejects.toThrow(
      "github-releases: failed to fetch everlier/missing#access_token=[REDACTED]&view=releases: HTTP error 400",
    );
  });
});
