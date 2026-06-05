import { describe, test, expect } from "bun:test";
import {
  extractAtomLink,
  extractFeedEntryTitle,
  extractFeedItemBody,
  extractFeedRootTitle,
  extractRssAtomItems,
  extractXmlText,
  normalizeXmlList,
  parseFeedXml,
} from "./adapters/atom";

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

  test("falls back to first href when no alternate rel", () => {
    const link = [
      { "@_href": "https://example.com/first", "@_rel": "self" },
      { "@_href": "https://example.com/second", "@_rel": "enclosure" },
    ];
    expect(extractAtomLink(link)).toBe("https://example.com/first");
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