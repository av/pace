import { describe, test, expect, afterEach } from "bun:test";
import {
  DEFAULT_GIST_RENDERER,
  formatGistPublishResult,
  publishGistArtifact,
  renderGistShareUrl,
} from "./share-gist";

const artifact = {
  html: "<!doctype html><title>pace</title>",
  css: "body{font-family:sans-serif}",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("share-gist", () => {
  afterEach(() => {
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  test("renderGistShareUrl uses gisthost by default", () => {
    expect(renderGistShareUrl("abc123")).toBe(`${DEFAULT_GIST_RENDERER}?abc123`);
  });

  test("publishGistArtifact creates secret gist by default and returns renderer URL", async () => {
    process.env.GITHUB_TOKEN = "token-1";
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ id: "gist123", html_url: "https://gist.github.com/u/gist123" });
    };

    const result = await publishGistArtifact(artifact, { fetchImpl });

    expect(result).toEqual({
      backend: "gist",
      gistId: "gist123",
      gistUrl: "https://gist.github.com/u/gist123",
      shareUrl: "https://gisthost.github.io/?gist123",
    });
    expect(calls[0].url).toBe("https://api.github.com/gists");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer token-1");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      public: false,
      files: {
        "index.html": { content: artifact.html },
        "styles.css": { content: artifact.css },
      },
    });
  });

  test("publishGistArtifact updates existing gist and supports custom renderer", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return jsonResponse({ id: "oldgist", html_url: "https://gist.github.com/u/oldgist" });
    };

    const result = await publishGistArtifact(artifact, {
      token: "token-2",
      gistId: "oldgist",
      public: true,
      renderer: "https://gistpreview.github.io",
      fetchImpl,
    });

    expect(calls[0].url).toBe("https://api.github.com/gists/oldgist");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body)).public).toBe(true);
    expect(result.shareUrl).toBe("https://gistpreview.github.io/?oldgist");
  });

  test("publishGistArtifact errors with share prefix when token is missing", async () => {
    await expect(publishGistArtifact(artifact, { fetchImpl: async () => jsonResponse({}) }))
      .rejects.toThrow("share: GitHub token required");
  });

  test("formatGistPublishResult reports backend and share URL", () => {
    expect(formatGistPublishResult({
      backend: "gist",
      gistId: "g",
      gistUrl: "https://gist.github.com/u/g",
      shareUrl: "https://gisthost.github.io/?g",
    })).toBe("backend: gist\ngist: https://gist.github.com/u/g\nurl: https://gisthost.github.io/?g");
  });
});
