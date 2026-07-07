import { describe, expect, test } from "bun:test";
import {
  buildFeedContentItem,
  decodeFeedEntryStrippedTitle,
  coalesceFeedEntryDateStr,
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_ATOM_ORDER,
  FEED_ENTRY_DATE_PODCAST_ORDER,
  FEED_ENTRY_DATE_RSS_ORDER,
  parseFeedEntryTimestamp,
  projectFeedEntryToContentItem,
  resolveDecodedFeedRootTitle,
} from "./adapters/feed-entry";

describe("coalesceFeedEntryDateStr", () => {
  test("follows RSS field order by default", () => {
    expect(
      coalesceFeedEntryDateStr({
        pubDate: "Mon, 01 Jan 2024 00:00:00 GMT",
        updated: "2024-02-01",
        published: "2024-03-01",
      }),
    ).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
    expect(
      coalesceFeedEntryDateStr({
        updated: "2024-02-01",
        published: "2024-03-01",
      }),
    ).toBe("2024-02-01");
  });

  test("supports Atom and podcast field orders", () => {
    expect(
      coalesceFeedEntryDateStr(
        { published: "2024-01-01", updated: "2024-02-01" },
        FEED_ENTRY_DATE_ATOM_ORDER,
      ),
    ).toBe("2024-01-01");
    expect(
      coalesceFeedEntryDateStr(
        { published: "2024-01-01", "dc:date": "2024-03-01" },
        FEED_ENTRY_DATE_PODCAST_ORDER,
      ),
    ).toBe("2024-01-01");
    expect(
      coalesceFeedEntryDateStr(
        { "dc:date": "2024-03-01" },
        FEED_ENTRY_DATE_PODCAST_ORDER,
      ),
    ).toBe("2024-03-01");
  });

  test("returns empty string when no date fields are set", () => {
    expect(coalesceFeedEntryDateStr({})).toBe("");
    expect(coalesceFeedEntryDateStr({}, FEED_ENTRY_DATE_RSS_ORDER)).toBe("");
  });

  test("extracts #text from date elements carrying XML attributes", () => {
    // `<updated type="iso8601">...</updated>` parses to an object; must not
    // stringify to "[object Object]".
    expect(
      coalesceFeedEntryDateStr({
        updated: { "#text": "2024-02-01T00:00:00Z", "@_type": "iso8601" } as never,
      }),
    ).toBe("2024-02-01T00:00:00Z");
  });

  test("skips attribute-only date objects and falls through the order", () => {
    expect(
      coalesceFeedEntryDateStr({
        pubDate: { "@_type": "iso8601" } as never,
        updated: "2024-02-01",
      }),
    ).toBe("2024-02-01");
  });
});

describe("parseFeedEntryTimestamp", () => {
  test("parses the first coalesced date field", () => {
    const timestamp = parseFeedEntryTimestamp({
      published: "2024-06-15T12:00:00Z",
    });
    expect(timestamp).toBeInstanceOf(Date);
    expect(timestamp.getUTCFullYear()).toBe(2024);
  });
});

describe("decodeFeedEntryTitle", () => {
  test("decodes numeric entities after extracting xml text", () => {
    expect(decodeFeedEntryTitle({ "#text": "A &#38; B" })).toBe("A & B");
    expect(decodeFeedEntryTitle(undefined, "missing")).toBe("missing");
  });
});

describe("decodeFeedEntryStrippedTitle", () => {
  test("strips html then decodes entities", () => {
    expect(
      decodeFeedEntryStrippedTitle({ "#text": "<b>Rock</b> &amp; Roll" }),
    ).toBe("Rock & Roll");
  });
});

describe("resolveDecodedFeedRootTitle", () => {
  test("prefers RSS title, decodes entities, and applies fallback", () => {
    expect(
      resolveDecodedFeedRootTitle("RSS &#38; Co", { "#text": "Atom" }),
    ).toBe("RSS & Co");
    expect(
      resolveDecodedFeedRootTitle(undefined, { "#text": "Atom &#38; Feed" }),
    ).toBe("Atom & Feed");
    expect(resolveDecodedFeedRootTitle(undefined, undefined, "Default")).toBe(
      "Default",
    );
    expect(resolveDecodedFeedRootTitle(undefined, undefined)).toBeUndefined();
  });
});

describe("extractFeedEntryStrippedBody", () => {
  test("strips html from the first available body field", () => {
    expect(
      extractFeedEntryStrippedBody({
        description: "<p>Hello <b>world</b></p>",
      }),
    ).toBe("Hello world");
    expect(extractFeedEntryStrippedBody({})).toBeUndefined();
  });
});

describe("buildFeedContentItem", () => {
  test("assembles ContentItem from resolved projection fields", () => {
    const timestamp = new Date("2024-06-15T12:00:00Z");
    expect(
      buildFeedContentItem("podcast:my-show:ep-1", {
        title: "Episode 1",
        url: "https://example.com/ep1",
        source: "podcast:my-show",
        timestamp,
        body: "Show notes",
      }),
    ).toEqual({
      id: "podcast:my-show:ep-1",
      title: "Episode 1",
      url: "https://example.com/ep1",
      source: "podcast:my-show",
      timestamp,
      body: "Show notes",
    });
  });
});

describe("projectFeedEntryToContentItem", () => {
  test("extracts shared title/timestamp then applies adapter-specific projection", () => {
    const item = projectFeedEntryToContentItem(
      "rss",
      {
        title: { "#text": "Hello &#38; World" },
        pubDate: "Mon, 15 Jun 2024 12:00:00 GMT",
      },
      ({ title }) => ({
        idSuffix: "item-1",
        url: "https://example.com/item-1",
        source: "Example Feed",
        body: `Body for ${title}`,
      }),
    );

    expect(item.id).toBe("rss:item-1");
    expect(item.title).toBe("Hello & World");
    expect(item.url).toBe("https://example.com/item-1");
    expect(item.source).toBe("Example Feed");
    expect(item.body).toBe("Body for Hello & World");
    expect(item.timestamp).toBeInstanceOf(Date);
    expect(item.timestamp.getUTCFullYear()).toBe(2024);
  });

  test("honors custom date field order", () => {
    const item = projectFeedEntryToContentItem(
      "youtube",
      {
        title: "Video",
        published: "2024-01-01T00:00:00Z",
        updated: "2024-02-01T00:00:00Z",
      },
      () => ({
        idSuffix: "vid-1",
        url: "https://youtube.com/watch?v=vid-1",
        source: "youtube:Channel",
      }),
      FEED_ENTRY_DATE_ATOM_ORDER,
    );

    expect(item.id).toBe("youtube:vid-1");
    expect(item.timestamp.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  test("allows projection to override decoded title", () => {
    const item = projectFeedEntryToContentItem(
      "github",
      { title: "v1.0.0", published: "2024-01-01T00:00:00Z" },
      () => ({
        idSuffix: "o/r:v1.0.0",
        url: "https://github.com/o/r/releases/tag/v1.0.0",
        source: "github:o/r",
        title: "o/r: v1.0.0 | Display Title",
      }),
      FEED_ENTRY_DATE_ATOM_ORDER,
    );

    expect(item.title).toBe("o/r: v1.0.0 | Display Title");
  });
});