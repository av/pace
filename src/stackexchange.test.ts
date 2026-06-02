import { describe, expect, spyOn, test } from "bun:test";
import stackexchangeAdapter from "./adapters/stackexchange";
import * as typesMod from "./adapters/types";
import { adapterCfg, useFetchMockSuite } from "./test/adapter-mocks";

const mocks = useFetchMockSuite();
const seCfg = (params: Record<string, unknown> = {}) => adapterCfg("stackexchange", params);

describe("stackexchange", () => {
  test("ngb contract", () => {
    expect(stackexchangeAdapter.name).toBe("stackexchange");
    expect(typeof stackexchangeAdapter.fetch).toBe("function");
  });

  function makeQuestion(overrides: Partial<Record<string, unknown>> = {}) {
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

  test("default site", async () => {
    const q = makeQuestion();
    mocks.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 },
      ),
    );

    const items = await stackexchangeAdapter.fetch(seCfg());

    expect(items.length).toBe(1);
    expect(items[0]).toMatchObject({
      id: "se:stackoverflow:123",
      title: "How to use Bun with TypeScript?",
      url: "https://stackoverflow.com/questions/123",
      source: "stackoverflow:hot",
      body: expect.stringContaining("Score: 42"),
    });
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("site=stackoverflow");
    expect(calledUrl).toContain("sort=hot");
    expect(calledUrl).not.toContain("tagged=");
  });

  test("blank-only site uses default stackoverflow", async () => {
    const q = makeQuestion();
    mocks.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 },
      ),
    );

    const items = await stackexchangeAdapter.fetch(seCfg({ site: "   " }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("se:stackoverflow:123");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("site=stackoverflow");
  });

  test("trims whitespace from configured site", async () => {
    const q = makeQuestion({ question_id: 88 });
    mocks.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 },
      ),
    );

    const items = await stackexchangeAdapter.fetch(
      seCfg({ site: "  ru.stackoverflow.com  " }),
    );

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("se:ru.stackoverflow.com:88");
    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("site=ru.stackoverflow.com");
  });

  test("blank-only tags behave like no tags configured", async () => {
    const q = makeQuestion();
    mocks.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 },
      ),
    );

    const items = await stackexchangeAdapter.fetch(seCfg({ tags: ["", "  "] }));

    expect(items).toHaveLength(1);
    expect(items[0].source).toBe("stackoverflow:hot");
    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = String(mocks.fetchMock.mock.calls[0][0]);
    expect(calledUrl).not.toContain("tagged=");
    expect(mocks.warnSpy).not.toHaveBeenCalled();
  });

  test("trims whitespace from configured tag names", async () => {
    const q = makeQuestion({ question_id: 55, tags: ["typescript"] });
    const empty = new Response(
      JSON.stringify({ items: [], has_more: false, quota_remaining: 99 }),
      { status: 200 },
    );
    mocks.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(empty);

    const items = await stackexchangeAdapter.fetch(
      seCfg({ tags: ["  typescript  ", "bun"], limit: 5 }),
    );

    expect(items).toHaveLength(1);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    const url0 = String(mocks.fetchMock.mock.calls[0][0]);
    const url1 = String(mocks.fetchMock.mock.calls[1][0]);
    expect(url0).toContain("tagged=typescript");
    expect(url1).toContain("tagged=bun");
    expect(items[0].source).toBe("stackoverflow:typescript+bun");
  });

  test("one tag per request", async () => {
    const q1 = makeQuestion({ question_id: 1, tags: ["typescript"] });
    const q2 = makeQuestion({ question_id: 2, tags: ["bun"] });
    mocks.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [q1], has_more: false, quota_remaining: 50 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [q2], has_more: false, quota_remaining: 49 }),
          { status: 200 },
        ),
      );

    const items = await stackexchangeAdapter.fetch(
      seCfg({
        site: "stackoverflow",
        tags: ["typescript", "bun"],
        sort: "votes",
        limit: 5,
      }),
    );

    expect(items).toHaveLength(2);
    expect(mocks.fetchMock).toHaveBeenCalledTimes(2);
    const url0 = String(mocks.fetchMock.mock.calls[0][0]);
    const url1 = String(mocks.fetchMock.mock.calls[1][0]);
    expect(url0).toContain("tagged=typescript");
    expect(url0).not.toContain("tagged=typescript%3Bbun");
    expect(url1).toContain("tagged=bun");
    expect(url0).toContain("sort=votes");
    expect(url0).toContain("pagesize=5");
  });

  test("dedupe across tags", async () => {
    const shared = makeQuestion({ question_id: 99, title: "Shared question" });
    const onlyTs = makeQuestion({ question_id: 1, title: "TS only" });
    mocks.fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [shared, onlyTs], has_more: false, quota_remaining: 50 }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ items: [shared], has_more: false, quota_remaining: 49 }),
          { status: 200 },
        ),
      );

    const items = await stackexchangeAdapter.fetch(
      seCfg({ tags: ["typescript", "bun"], limit: 10 }),
    );

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.id)).toEqual(
      expect.arrayContaining(["se:stackoverflow:99", "se:stackoverflow:1"]),
    );
  });

  test("min_score and limit", async () => {
    const questions = [
      makeQuestion({ question_id: 10, score: 5 }),
      makeQuestion({ question_id: 20, score: 100 }),
      makeQuestion({ question_id: 30, score: 20 }),
    ];
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: questions, has_more: false, quota_remaining: 100 }), {
        status: 200,
      }),
    );

    const items = await stackexchangeAdapter.fetch(seCfg({ min_score: 10, limit: 1 }));

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("se:stackoverflow:20");
  });

  test("decodes HTML entities in question titles from API", async () => {
    const q = makeQuestion({ title: "A &amp; B &#8364; C" });
    mocks.fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ items: [q], has_more: false, quota_remaining: 100 }),
        { status: 200 },
      ),
    );

    const [item] = await stackexchangeAdapter.fetch(seCfg());

    expect(item.title).toBe("A & B € C");
  });

  test("body fields", async () => {
    const q = makeQuestion({
      view_count: 2500,
      answer_count: 5,
      accepted_answer_id: 99,
      owner: { display_name: "dev" },
    });
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], quota_remaining: 100 }), { status: 200 }),
    );

    const [item] = await stackexchangeAdapter.fetch(seCfg());

    expect(item.body).toContain("Score: 42");
    expect(item.body).toContain("5 answers (accepted)");
    expect(item.body).toContain("2.5k views");
    expect(item.body).toContain("tags: typescript, bun");
    expect(item.body).toContain("by dev");
  });

  test("!ok throws", async () => {
    mocks.fetchMock.mockResolvedValue(
      new Response("too many", { status: 429, statusText: "Too Many Requests" }),
    );

    await expect(
      stackexchangeAdapter.fetch(seCfg({ site: "meta.stackexchange.com" })),
    ).rejects.toThrow(/stackexchange: failed to fetch from meta.stackexchange.com: HTTP error 429/);
  });

  test("low quota warns", async () => {
    const q = makeQuestion({ question_id: 777 });
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], has_more: false, quota_remaining: 3 }), { status: 200 }),
    );

    const items = await stackexchangeAdapter.fetch(seCfg({ site: "stackoverflow" }));

    expect(items).toHaveLength(1);
    expect(mocks.warnSpy).toHaveBeenCalledWith("stackexchange: API quota low (3 remaining)");
  });

  test("network throws", async () => {
    mocks.fetchMock.mockRejectedValue(new Error("connection refused"));

    await expect(
      stackexchangeAdapter.fetch(seCfg({ site: "bad.site" })),
    ).rejects.toThrow(/stackexchange: error fetching from bad.site: connection refused/);
  });

  test("invalid sort and view format", async () => {
    const q = makeQuestion({ view_count: 1234567 });
    mocks.fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ items: [q], quota_remaining: 100 }), { status: 200 }),
    );

    const items = await stackexchangeAdapter.fetch(
      seCfg({ sort: "invalid", site: "ru.stackoverflow.com" }),
    );

    expect(items[0].source).toBe("ru.stackoverflow.com:hot");
    expect(items[0].body).toContain("1.2m views");
  });

  test("errorMessage on !ok and network", async () => {
    const emSpy = spyOn(typesMod, "errorMessage");
    try {
      mocks.fetchMock.mockResolvedValue(
        new Response("rate limit", { status: 429, statusText: "Too Many Requests" }),
      );
      await expect(
        stackexchangeAdapter.fetch(seCfg({ site: "meta.stackexchange.com" })),
      ).rejects.toThrow(/429/);

      mocks.fetchMock.mockRejectedValue(new Error("connection refused"));
      await expect(
        stackexchangeAdapter.fetch(seCfg({ site: "bad.site" })),
      ).rejects.toThrow(/connection refused/);

      expect(emSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(emSpy).toHaveBeenCalledWith({ message: "HTTP error 429" });
    } finally {
      emSpy.mockRestore();
    }
  });
});