import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { runPipeline } from "./transforms";
import { lookupWithAbort } from "./fetch-content";
import { makeContentItemRow as makeRow } from "./test/content-items";
import * as piAi from "@mariozechner/pi-ai";
import { spyOn } from "bun:test";

const fakeModel = { id: "fake" } as piAi.Model<piAi.Api>;

const originalFetch = globalThis.fetch;

function makeFetchMock() {
  const fetchMock = mock();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function makeHtmlResponse(html: string, contentType = "text/html; charset=utf-8") {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(html);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset));
      offset = bytes.length;
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: (h: string) => h.toLowerCase() === "content-type" ? contentType : null },
    body: stream,
  } as unknown as Response;
}

describe("fetch_content in llm-summarize", () => {
  let completeSpy: ReturnType<typeof spyOn>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    completeSpy = spyOn(piAi, "complete").mockResolvedValue({
      content: [{ type: "text", text: '[{"id":"a","summary":"Fetched summary."}]' }],
    } as Awaited<ReturnType<typeof piAi.complete>>);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    completeSpy.mockRestore();
    restoreFetch();
  });

  test("fetches URL and passes content to LLM", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(makeHtmlResponse("<html><body><p>Article text</p></body></html>"));

    const items = [makeRow({ id: "a", url: "https://example.com/article", summary: null })];
    const result = await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://example.com/article");

    // The LLM should have been called with content including the fetched text
    const callArg = completeSpy.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(callArg.messages[0].content).toContain("Article text");

    expect(result[0]?.summary).toBe("Fetched summary.");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("skips fetch for items that already have a summary", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(makeHtmlResponse("<p>Should not be fetched</p>"));

    const items = [
      makeRow({ id: "a", url: "https://example.com/1", summary: "Already summarized" }),
    ];
    const result = await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    // Fetch should not have been called - item was already summarized
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result[0]?.summary).toBe("Already summarized");
  });

  test("falls back gracefully when fetch fails (network error)", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockRejectedValue(new Error("network error"));

    completeSpy.mockResolvedValue({
      content: [{ type: "text", text: '[{"id":"a","summary":"Title-based summary."}]' }],
    } as Awaited<ReturnType<typeof piAi.complete>>);

    const items = [
      makeRow({
        id: "a",
        url: "https://fail.example.com/article?api_key=query-secret#access_token=fragment-secret",
        summary: null,
      }),
    ];
    const result = await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    // LLM still called; summary still written (without fetch content)
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(result[0]?.summary).toBe("Title-based summary.");
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: fetch_content unavailable for 1 of 1 pending item(s); summaries will use available item metadata",
    );
    expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("query-secret");
    expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("fragment-secret");
  });

  test("falls back when content-type is not text/html or text/plain", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(makeHtmlResponse("<binary data>", "application/octet-stream"));

    const items = [makeRow({ id: "a", url: "https://example.com/binary", summary: null })];
    await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    // LLM called but without `content:` in message (no fetched text available)
    const callArg = completeSpy.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(callArg.messages[0].content).not.toContain("| content:");
  });

  test("reports partial enrichment failure once with aggregate counts", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockImplementation((url: string | URL) => Promise.resolve(
      String(url).endsWith("/ok")
        ? makeHtmlResponse("<p>Available article</p>")
        : makeHtmlResponse("binary", "application/octet-stream"),
    ));

    const items = [
      makeRow({ id: "a", url: "https://example.com/ok", summary: null }),
      makeRow({ id: "b", url: "https://example.com/bad-1?api_key=secret", summary: null }),
      makeRow({ id: "c", url: "https://example.com/bad-2#token=secret", summary: null }),
    ];
    await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: fetch_content unavailable for 2 of 3 pending item(s); summaries will use available item metadata",
    );
  });

  test("private network destinations are blocked by default, including redirect hops", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(Response.redirect("http://127.0.0.1:17480/secret", 302));
    const items = [
      makeRow({ id: "a", url: "http://127.0.0.1:17480/direct", summary: null }),
      makeRow({ id: "b", url: "http://93.184.216.34/public-redirect", summary: null }),
      makeRow({ id: "c", url: "http://169.254.169.254/latest/meta-data", summary: null }),
    ];
    await runPipeline(items, [{ type: "llm-summarize", fetch_content: true }], {
      llmModel: fakeModel,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://93.184.216.34/public-redirect");
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: fetch_content unavailable for 3 of 3 pending item(s); summaries will use available item metadata",
    );
  });

  test("private network fetches require the explicit local-development opt-in", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(makeHtmlResponse("<p>Trusted local article</p>"));
    const items = [makeRow({ id: "a", url: "http://127.0.0.1:17480/article", summary: null })];
    await runPipeline(
      items,
      [{
        type: "llm-summarize",
        fetch_content: true,
        fetch_content_allow_private: true,
      }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArg = completeSpy.mock.calls[0][1] as { messages: Array<{ content: string }> };
    expect(callArg.messages[0].content).toContain("Trusted local article");
  });

  test("adversarial private network URL forms are blocked with a safe aggregate diagnostic", async () => {
    const fetchMock = makeFetchMock();
    const urls = [
      "http://2130706433/secret",
      "http://0177.0.0.1/secret",
      "http://0x7f000001/secret",
      "http://127.1/secret",
      "http://[::ffff:127.0.0.1]/secret",
      "http://[0:0:0:0:0:ffff:7f00:1]/secret",
      "http://[::1]/secret",
      "http://[fe80::1]/secret",
      "http://LOCALHOST./secret",
      "http://LoCaLhOsT/secret",
    ];
    await runPipeline(
      urls.map((url, index) => makeRow({ id: String(index), url, summary: null })),
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: fetch_content blocked 10 private-network request(s); set fetch_content_allow_private only for trusted local sources",
    );
    expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("127.0.0.1");
    expect(warnSpy.mock.calls.flat().join(" ")).not.toContain("localhost");
  });

  test("redirect loops and malformed locations fail within the redirect cap", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockImplementation((url: URL) => Promise.resolve(
      String(url).includes("malformed")
        ? new Response(null, { status: 302, headers: { location: "http://[" } })
        : new Response(null, {
          status: 302,
          headers: { location: "http://93.184.216.34/loop" },
        }),
    ));
    await runPipeline([
      makeRow({ id: "loop", url: "http://93.184.216.34/loop", summary: null }),
      makeRow({ id: "malformed", url: "http://93.184.216.34/malformed", summary: null }),
    ], [{ type: "llm-summarize", fetch_content: true }], { llmModel: fakeModel });

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(warnSpy).toHaveBeenCalledWith(
      "llm: fetch_content unavailable for 2 of 2 pending item(s); summaries will use available item metadata",
    );
  });

  test("skips fetch for items with empty url", async () => {
    const fetchMock = makeFetchMock();
    fetchMock.mockResolvedValue(makeHtmlResponse("<p>Irrelevant</p>"));

    const items = [makeRow({ id: "a", url: "", summary: null })];
    await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch_content: false does not fetch", async () => {
    const fetchMock = makeFetchMock();

    const items = [makeRow({ id: "a", url: "https://example.com", summary: null })];
    await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: false }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("without fetch_content option does not fetch", async () => {
    const fetchMock = makeFetchMock();

    const items = [makeRow({ id: "a", url: "https://example.com", summary: null })];
    await runPipeline(
      items,
      [{ type: "llm-summarize" }],
      { llmModel: fakeModel },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("lookupWithAbort", () => {
  test("rejects immediately when the signal is already aborted, without calling lookup", async () => {
    const controller = new AbortController();
    controller.abort(new Error("budget exhausted"));
    const lookupFn = mock(() => new Promise<never>(() => {}));
    const start = performance.now();
    await expect(lookupWithAbort("example.com", controller.signal, lookupFn)).rejects.toThrow("budget exhausted");
    expect(performance.now() - start).toBeLessThan(50);
    expect(lookupFn).not.toHaveBeenCalled();
  });

  test("rejects promptly when the signal aborts while the lookup hangs", async () => {
    const controller = new AbortController();
    // Simulates a pathological resolver: the lookup promise never settles.
    const lookupFn = mock(() => new Promise<never>(() => {}));
    const pending = lookupWithAbort("example.com", controller.signal, lookupFn);
    // Bun's expect(...).rejects settles the promise before subsequent sync code
    // runs, so the abort must be scheduled ahead of awaiting the expectation.
    setTimeout(() => controller.abort(new Error("fetch budget hit")), 10);
    await expect(pending).rejects.toThrow("fetch budget hit");
    expect(lookupFn).toHaveBeenCalledTimes(1);
  });

  test("resolves with lookup addresses and removes its abort listener when the lookup wins", async () => {
    const controller = new AbortController();
    const lookupFn = mock(async () => [{ address: "93.184.216.34", family: 4 }]);
    const addresses = await lookupWithAbort("example.com", controller.signal, lookupFn);
    expect(addresses).toEqual([{ address: "93.184.216.34", family: 4 }]);
    // Aborting afterwards must not surface an unhandled rejection from a stale listener.
    controller.abort(new Error("late abort"));
  });

  test("passes through lookup failures (e.g. NXDOMAIN)", async () => {
    const controller = new AbortController();
    const lookupFn = mock(() => Promise.reject(new Error("getaddrinfo ENOTFOUND nope.invalid")));
    await expect(lookupWithAbort("nope.invalid", controller.signal, lookupFn)).rejects.toThrow("ENOTFOUND");
  });
});
