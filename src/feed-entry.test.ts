import { describe, expect, test } from "bun:test";
import {
  coalesceFeedEntryDateStr,
  decodeFeedEntryTitle,
  extractFeedEntryStrippedBody,
  FEED_ENTRY_DATE_ATOM_ORDER,
  FEED_ENTRY_DATE_PODCAST_ORDER,
  FEED_ENTRY_DATE_RSS_ORDER,
  parseFeedEntryTimestamp,
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