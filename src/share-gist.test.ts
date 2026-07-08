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

  test("whitespace-only env token is treated as missing", async () => {
    process.env.GITHUB_TOKEN = "   \n";
    await expect(publishGistArtifact(artifact, { fetchImpl: async () => jsonResponse({}) }))
      .rejects.toThrow("share: GitHub token required");
  });

  test("padded token is trimmed before building the Authorization header", async () => {
    const calls: { init: RequestInit }[] = [];
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push({ init: init ?? {} });
      return jsonResponse({ id: "g1", html_url: "https://gist.github.com/u/g1" });
    };
    await publishGistArtifact(artifact, { token: "  ghp_pad \n", fetchImpl });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer ghp_pad");
  });

  test("publish request carries an abort signal with a timeout", async () => {
    let signal: AbortSignal | null | undefined;
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      signal = init?.signal;
      return jsonResponse({ id: "g1", html_url: "https://gist.github.com/u/g1" });
    };
    await publishGistArtifact(artifact, { token: "t", fetchImpl });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);
  });

  test("timed-out request produces a share-prefixed timeout error", async () => {
    const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
      // Simulate fetch honoring the timeout signal.
      const err = new Error("The operation timed out.");
      err.name = "TimeoutError";
      void init;
      throw err;
    };
    await expect(publishGistArtifact(artifact, { token: "t", fetchImpl }))
      .rejects.toThrow(/share: GitHub Gist publish timed out after \d+ms/);
  });

  test("401 failure includes a token hint", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Bad credentials" }, 401);
    await expect(publishGistArtifact(artifact, { token: "bad", fetchImpl }))
      .rejects.toThrow(/failed with 401.*\(check your GitHub token\)/s);
  });

  test("404 on update includes a gist-id hint", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Not Found" }, 404);
    await expect(publishGistArtifact(artifact, { token: "t", gistId: "nope", fetchImpl }))
      .rejects.toThrow(/failed with 404.*gist "nope" not found — check --gist-id/s);
  });

  test("404 on create includes a scope hint", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Not Found" }, 404);
    await expect(publishGistArtifact(artifact, { token: "t", fetchImpl }))
      .rejects.toThrow(/failed with 404.*token lacks the "gist" scope/s);
  });

  test("422 failure includes a size-limit hint", async () => {
    const fetchImpl = async () => jsonResponse({ message: "Validation Failed" }, 422);
    await expect(publishGistArtifact(artifact, { token: "t", fetchImpl }))
      .rejects.toThrow(/failed with 422.*may exceed gist size limits/s);
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
