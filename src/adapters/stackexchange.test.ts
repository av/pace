import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import adapter from "./stackexchange";
import * as typesMod from "./types";

describe("stackexchange adapter", () => {
  let fetchMock: ReturnType<typeof mock>;
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    fetchMock = mock();
    globalThis.fetch = fetchMock as any;
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
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

  it("returns empty list when no subreddits? wait no, for no config it still fetches default site", async () => {
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

  it("returns [] and warns on HTTP !ok response (preserves current swallow behavior)", async () => {
    fetchMock.mockResolvedValue(
      new Response("too many", { status: 429, statusText: "Too Many Requests" })
    );

    const items = await adapter.fetch({ type: "stackexchange", params: { site: "meta.stackexchange.com" } });

    expect(items).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      "stackexchange: failed to fetch from meta.stackexchange.com: 429 Too Many Requests"
    );
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

  it("returns [] and warns on network/fetch rejection (preserves current swallow behavior)", async () => {
    fetchMock.mockRejectedValue(new Error("connection refused"));

    const items = await adapter.fetch({ type: "stackexchange", params: { site: "bad.site" } });

    expect(items).toEqual([]);
    // second arg is the err; first now includes cause via errorMessage (mmu quality)
    expect(warnSpy).toHaveBeenCalledWith(
      "stackexchange: error fetching from bad.site: connection refused",
      expect.any(Error)
    );
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

  it("uses errorMessage helper in !ok and network error warn paths per mmu/sh1 (warn+[] recoverable per contract; TDD coverage for stackexchange errorMessage use)", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      // !ok HTTP error path (exercises warnAndReturnEmpty + errorMessage for status obj)
      fetchMock.mockResolvedValue(
        new Response("rate limit", { status: 429, statusText: "Too Many Requests" })
      );
      const items1 = await adapter.fetch({ type: "stackexchange", params: { site: "meta.stackexchange.com" } });
      expect(items1).toEqual([]);

      // network/fetch reject path (exercises catch + errorMessage(err))
      fetchMock.mockRejectedValue(new Error("connection refused for se mmu test"));
      const items2 = await adapter.fetch({ type: "stackexchange", params: { site: "bad.site" } });
      expect(items2).toEqual([]);

      // will be >=2 calls post-edit (status helper + err helper); pre-edit 0 -> red
      const calls = emSpy.mock.calls.length;
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(emSpy).toHaveBeenCalledWith({ message: "429 Too Many Requests" });
    } finally {
      emSpy.mockRestore();
    }
  });
});
