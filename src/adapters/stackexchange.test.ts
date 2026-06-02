import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import adapter from "./stackexchange";
import * as typesMod from "./types";

describe("stackexchange adapter", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    warnSpy.mockRestore();
  });

  function makeQuestion(overrides: Partial<any> = {}) {
    return {
      question_id: 123,
      title: "How to use Bun with TypeScript?",
      link: "https://stackoverflow.com/questions/123",
      score: 42,
      answer_count: 3,
      view_count: 1500,
      tags: ["typescript", "bun"],
      owner: { display_name: "bunfan" },
      creation_date: 1700000000,
      is_answered: true,
      accepted_answer_id: 456,
      ...overrides,
    };
  }

  it("fetches default site when no/empty params", async () => {
    const q = makeQuestion();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 }
      )
    );

    const items = await adapter.fetch({ type: "stackexchange", params: {} });

    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      id: "se:stackoverflow:123",
      title: "How to use Bun with TypeScript?",
      url: "https://stackoverflow.com/questions/123",
      source: "stackoverflow:hot",
      body: expect.stringContaining("Score: 42"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("site=stackoverflow");
    expect(calledUrl).toContain("sort=hot");
    expect(calledUrl).not.toContain("tagged=");
  });

  it("fetches with tags (semicolon joined), custom site, sort, limit", async () => {
    const q1 = makeQuestion({ question_id: 1, tags: ["ts"] });
    const q2 = makeQuestion({ question_id: 2, tags: ["bun"] });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q1, q2], has_more: false, quota_remaining: 50 }),
        { status: 200 }
      )
    );

    const items = await adapter.fetch({
      type: "stackexchange",
      params: {
        site: "stackoverflow",
        tags: ["typescript", "bun"],
        sort: "votes",
        limit: 5,
      },
    });

    expect(items).toHaveLength(2);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("tagged=typescript%3Bbun"); // ; encoded
    expect(url).toContain("sort=votes");
    expect(url).toContain("pagesize=5");
  });

  it("applies min_score filter and limit after fetch", async () => {
    const questions = [
      makeQuestion({ question_id: 10, score: 5 }),
      makeQuestion({ question_id: 20, score: 100 }),
      makeQuestion({ question_id: 30, score: 20 }),
    ];
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: questions, has_more: false, quota_remaining: 100 }), { status: 200 })
    );

    const items = await adapter.fetch({
      type: "stackexchange",
      params: { min_score: 10, limit: 1 },
    });

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("se:stackoverflow:20");
  });

  it("builds rich body including accepted answers, views formatted, tags, owner", async () => {
    const q = makeQuestion({ view_count: 2500, answer_count: 5, accepted_answer_id: 99, owner: { display_name: "dev" } });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], quota_remaining: 100 }), { status: 200 })
    );

    const [item] = await adapter.fetch({ type: "stackexchange", params: {} });

    expect(item.body).toContain("Score: 42");
    expect(item.body).toContain("5 answers (accepted)");
    expect(item.body).toContain("2.5k views");
    expect(item.body).toContain("tags: typescript, bun");
    expect(item.body).toContain("by dev");
  });

  it("throws on HTTP !ok response (contract; no swallow)", async () => {
    fetchMock.mockResolvedValue(
      new Response("too many", { status: 429, statusText: "Too Many Requests" })
    );

    await expect(adapter.fetch({ type: "stackexchange", params: { site: "meta.stackexchange.com" } })).rejects.toThrow(/stackexchange: failed to fetch from meta.stackexchange.com: 429 Too Many Requests/);
    // no [] return or warn for fetch errors
  });

  it("warns on low quota but still returns results", async () => {
    const q = makeQuestion({ question_id: 777 });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], has_more: false, quota_remaining: 3 }), { status: 200 })
    );

    const items = await adapter.fetch({ type: "stackexchange", params: { site: "stackoverflow" } });

    expect(items).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "stackexchange: API quota low (3 remaining)"
    );
  });

  it("throws on network/fetch rejection (contract; no swallow)", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(adapter.fetch({ type: "stackexchange", params: { site: "bad.site" } })).rejects.toThrow(/stackexchange: error fetching from bad.site: connection refused/);
  });

  it("defaults sort to hot when invalid, handles large view counts", async () => {
    const q = makeQuestion({ view_count: 1234567 });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], quota_remaining: 100 }), { status: 200 })
    );

    const items = await adapter.fetch({
      type: "stackexchange",
      params: { sort: "invalid", site: "ru.stackoverflow.com" },
    });

    expect(items[0].source).toBe("ru.stackoverflow.com:hot");
    expect(items[0].body).toContain("1.2m views");
  });

  it("uses errorMessage helper in !ok and network error throw paths per contract (mmu/sh1; TDD coverage for stackexchange errorMessage use)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      // !ok HTTP error path (now throws, exercises errorMessage for status obj)
      fetchMock.mockResolvedValue(
        new Response("rate limit", { status: 429, statusText: "Too Many Requests" })
      );
      await expect(adapter.fetch({ type: "stackexchange", params: { site: "meta.stackexchange.com" } })).rejects.toThrow(/429/);

      // network/fetch reject path (now throws, exercises errorMessage(err))
      fetchMock.mockRejectedValue(new Error("connection refused for se mmu test"));
      await expect(adapter.fetch({ type: "stackexchange", params: { site: "bad.site" } })).rejects.toThrow(/connection refused/);

      // >=2 calls (status + err); 
      const calls = emSpy.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(emSpy).toHaveBeenCalledWith({ message: "429 Too Many Requests" });
    } finally {
      emSpy.mockRestore();
      globalThis.fetch = origFetch;  // ensure no pollution even on early exit
    }
  });
});
