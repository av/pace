import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { runPipeline } from "./transforms";
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

  beforeEach(() => {
    completeSpy = spyOn(piAi, "complete").mockResolvedValue({
      content: [{ type: "text", text: '[{"id":"a","summary":"Fetched summary."}]' }],
    } as Awaited<ReturnType<typeof piAi.complete>>);
  });

  afterEach(() => {
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

    const items = [makeRow({ id: "a", url: "https://fail.example.com", summary: null })];
    const result = await runPipeline(
      items,
      [{ type: "llm-summarize", fetch_content: true }],
      { llmModel: fakeModel },
    );

    // LLM still called; summary still written (without fetch content)
    expect(completeSpy).toHaveBeenCalledTimes(1);
    expect(result[0]?.summary).toBe("Title-based summary.");
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
