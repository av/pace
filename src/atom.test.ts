import { describe, test, expect } from "bun:test";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractRssAtomItems,
  extractXmlText,
  normalizeFeedItemList,
  shouldWarnLegitimatelyEmptyFeed,
  normalizeXmlList,
  parseFeedXml,
} from "./adapters/atom";
import { spyConsole } from "./test/console-spy";

describe("extractXmlText", () => {
  test("returns undefined for missing or empty values", () => {
    expect(extractXmlText(undefined)).toBeUndefined();
    expect(extractXmlText("")).toBeUndefined();
    expect(extractXmlText({ "#text": "" })).toBeUndefined();
  });

  test("reads plain strings and #text / __cdata nodes", () => {
    expect(extractXmlText("hello")).toBe("hello");
    expect(extractXmlText({ "#text": "from text node" })).toBe("from text node");
    expect(extractXmlText({ __cdata: "from cdata" })).toBe("from cdata");
  });

  test("stringifies numeric values from coercing parsers", () => {
    expect(extractXmlText(1984 as unknown as string)).toBe("1984");
    expect(extractXmlText({ "#text": 42 as unknown as string })).toBe("42");
  });
});

describe("feed parser numeric text nodes", () => {
  test("keeps numeric-looking titles, guids, and bodies as strings", () => {
    const xml = [
      "<rss><channel><title>2600</title>",
      "<item><title>1984</title><link>https://x.com/a</link>",
      "<description>42</description><guid>12345</guid>",
      "<pubDate>Mon, 06 Jul 2026 10:00:00 GMT</pubDate></item>",
      "</channel></rss>",
    ].join("");
    type Item = {
      title?: string;
      description?: string;
      guid?: string;
      pubDate?: string;
    };
    const parsed = parseFeedXml<{
      rss: { channel: { title?: string; item: Item } };
    }>(xml, "rss", "test");
    const channel = parsed.rss.channel;
    expect(channel.title).toBe("2600");
    expect(channel.item.title).toBe("1984");
    expect(channel.item.description).toBe("42");
    expect(channel.item.guid).toBe("12345");
    expect(extractXmlText(channel.item.title)).toBe("1984");
  });
});

describe("normalizeXmlList", () => {
  test("returns [] for missing values and wraps singletons", () => {
    expect(normalizeXmlList(undefined)).toEqual([]);
    expect(normalizeXmlList({ id: "a" })).toEqual([{ id: "a" }]);
    expect(normalizeXmlList([{ id: "a" }, { id: "b" }])).toEqual([
      { id: "a" },
      { id: "b" },
    ]);
  });
});

describe("extractFeedItemBody", () => {
  test("coalesces description, itunes, summary, content, and content:encoded", () => {
    expect(extractFeedItemBody({})).toBeUndefined();
    expect(extractFeedItemBody({ description: "rss desc" })).toBe("rss desc");
    expect(
      extractFeedItemBody({ description: "", summary: { "#text": "atom sum" } }),
    ).toBe("atom sum");
    expect(
      extractFeedItemBody({
        description: "skip",
        content: { "#text": "atom body" },
        "content:encoded": "encoded",
      }),
    ).toBe("skip");
    expect(
      extractFeedItemBody({
        summary: "",
        "content:encoded": { "#text": "encoded only" },
      }),
    ).toBe("encoded only");
    expect(
      extractFeedItemBody({
        description: "",
        "itunes:summary": { "#text": "show notes" },
        "itunes:subtitle": "subtitle",
      }),
    ).toBe("show notes");
    expect(
      extractFeedItemBody({
        "itunes:summary": "",
        "itunes:subtitle": "teaser",
        "content:encoded": "full html",
      }),
    ).toBe("teaser");
  });
});

describe("extractFeedEntryTitle", () => {
  test("uses fallback when title is missing or empty", () => {
    expect(extractFeedEntryTitle(undefined)).toBe("(untitled)");
    expect(extractFeedEntryTitle("")).toBe("(untitled)");
    expect(extractFeedEntryTitle(undefined, "no title")).toBe("no title");
  });

  test("reads plain strings and #text nodes", () => {
    expect(extractFeedEntryTitle("Launch")).toBe("Launch");
    expect(extractFeedEntryTitle({ "#text": "From node" })).toBe("From node");
  });
});

describe("extractFeedRootTitle", () => {
  test("prefers RSS channel title over Atom feed title", () => {
    expect(extractFeedRootTitle("RSS Title", "Atom Title")).toBe("RSS Title");
    expect(extractFeedRootTitle(undefined, { "#text": "Atom only" })).toBe(
      "Atom only",
    );
  });
});

describe("normalizeFeedItemList", () => {
  test("returns [] for absent values and wraps singleton objects", () => {
    expect(normalizeFeedItemList(undefined, "item")).toEqual([]);
    expect(normalizeFeedItemList({ title: "one" }, "item")).toEqual([
      { title: "one" },
    ]);
    expect(
      normalizeFeedItemList([{ id: "a" }, { id: "b" }], "entry"),
    ).toEqual([{ id: "a" }, { id: "b" }]);
  });

  test("returns [] for malformed primitives without warn when context omitted", () => {
    expect(normalizeFeedItemList("broken", "item")).toEqual([]);
    expect(normalizeFeedItemList([{ ok: true }, "bad"], "item")).toEqual([]);
  });

  test("warns on malformed shape when warn context is provided", async () => {
    await spyConsole(["warn"], ({ warn: warnSpy }) => {
      expect(
        normalizeFeedItemList("broken", "item", {
          prefix: "rss",
          context: "https://ex.com/feed",
        }),
      ).toEqual([]);
      expect(warnSpy).toHaveBeenCalledWith(
        'rss: expected feed field "item" for https://ex.com/feed (got string), treating as empty',
      );

      normalizeFeedItemList([{ ok: true }, null], "entry", {
        prefix: "arxiv",
        context: 'query "cat:cs.AI"',
      });
      expect(warnSpy).toHaveBeenCalledWith(
        'arxiv: expected feed field "entry" for query "cat:cs.AI" (array contains non-object entry), treating as empty',
      );
    });
  });
});

describe("extractRssAtomItems", () => {
  test("reads RSS channel items or Atom entries", () => {
    expect(extractRssAtomItems({})).toEqual([]);
    expect(
      extractRssAtomItems({
        rss: { channel: { item: { title: "one" } } },
      }),
    ).toEqual([{ title: "one" }]);
    expect(
      extractRssAtomItems({
        feed: { entry: [{ title: "a" }, { title: "b" }] },
      }),
    ).toEqual([{ title: "a" }, { title: "b" }]);
  });

  test("prefers RSS items over Atom entries when both are present", () => {
    expect(
      extractRssAtomItems({
        rss: { channel: { item: { title: "rss" } } },
        feed: { entry: { title: "atom" } },
      }),
    ).toEqual([{ title: "rss" }]);
  });

  test("returns [] for malformed item/entry fields instead of coercing primitives", () => {
    expect(
      extractRssAtomItems({
        rss: { channel: { item: "broken" } },
      }),
    ).toEqual([]);
    expect(
      extractRssAtomItems({
        feed: { entry: 42 as unknown as { title: string } },
      }),
    ).toEqual([]);
  });
});

describe("shouldWarnLegitimatelyEmptyFeed", () => {
  test("true when feed root exists but item/entry field is absent or empty", () => {
    expect(
      shouldWarnLegitimatelyEmptyFeed({ feed: {} }, []),
    ).toBe(true);
    expect(
      shouldWarnLegitimatelyEmptyFeed({ rss: { channel: {} } }, []),
    ).toBe(true);
    expect(
      shouldWarnLegitimatelyEmptyFeed({ rss: { channel: { item: [] } } }, []),
    ).toBe(true);
    expect(
      shouldWarnLegitimatelyEmptyFeed({ feed: { entry: [] } }, []),
    ).toBe(true);
  });

  test("false when items exist, feed root is missing, or item/entry field is malformed", () => {
    expect(
      shouldWarnLegitimatelyEmptyFeed(
        { rss: { channel: { item: { title: "one" } } } },
        [{ title: "one" }],
      ),
    ).toBe(false);
    expect(shouldWarnLegitimatelyEmptyFeed({}, [])).toBe(false);
    expect(
      shouldWarnLegitimatelyEmptyFeed(
        { rss: { channel: { item: "broken" } } },
        [],
      ),
    ).toBe(false);
    expect(
      shouldWarnLegitimatelyEmptyFeed(
        { feed: { entry: "broken" as unknown as { title: string } } },
        [],
      ),
    ).toBe(false);
  });
});

describe("extractAtomLink", () => {
  test("returns empty string when link is missing", () => {
    expect(extractAtomLink(undefined)).toBe("");
  });

  test("returns RSS string links as-is", () => {
    expect(extractAtomLink("https://example.com/item")).toBe(
      "https://example.com/item",
    );
  });

  test("reads href from a single Atom link object", () => {
    expect(extractAtomLink({ "@_href": "https://a.example/x" })).toBe(
      "https://a.example/x",
    );
  });

  test("prefers rel=alternate in link arrays", () => {
    const link = [
      { "@_href": "https://example.com/self", "@_rel": "self" },
      { "@_href": "https://example.com/page", "@_rel": "alternate" },
    ];
    expect(extractAtomLink(link)).toBe("https://example.com/page");
  });

  test("returns empty when all links are non-page rels", () => {
    const link = [
      { "@_href": "https://example.com/first", "@_rel": "self" },
      { "@_href": "https://example.com/second", "@_rel": "enclosure" },
    ];
    expect(extractAtomLink(link)).toBe("");
  });

  test("single link object with rel=enclosure is not the item URL", () => {
    expect(
      extractAtomLink({
        "@_href": "https://cdn.example/episode.mp3",
        "@_rel": "enclosure",
      }),
    ).toBe("");
    expect(
      extractAtomLink({
        "@_href": "https://example.com/feed.xml",
        "@_rel": "self",
      }),
    ).toBe("");
  });

  test("prefers rel-less link over unknown rel, unknown rel over nothing", () => {
    expect(
      extractAtomLink([
        { "@_href": "https://example.com/related", "@_rel": "related" },
        { "@_href": "https://example.com/page" },
      ]),
    ).toBe("https://example.com/page");
    expect(
      extractAtomLink([
        { "@_href": "https://example.com/self", "@_rel": "self" },
        { "@_href": "https://example.com/related", "@_rel": "related" },
      ]),
    ).toBe("https://example.com/related");
  });

  test("skips alternate links without href", () => {
    expect(
      extractAtomLink([
        { "@_rel": "alternate" },
        { "@_href": "https://example.com/page" },
      ]),
    ).toBe("https://example.com/page");
  });
});

describe("parseFeedXml", () => {
  test("parses valid feed XML", () => {
    const xml = `<?xml version="1.0"?><feed><title>Test</title></feed>`;
    const parsed = parseFeedXml<{ feed?: { title?: string } }>(
      xml,
      "rss",
      "https://ex.com/feed",
    );
    expect(parsed.feed?.title).toBe("Test");
  });

  test("throws with adapter prefix and context on parse failure", () => {
    const xml = "<?xml><invalid>not closed";
    expect(() => parseFeedXml(xml, "youtube", "https://youtube.com/feeds/videos.xml")).toThrow(
      /youtube: error parsing xml from https:\/\/youtube.com\/feeds\/videos\.xml/,
    );
  });
});