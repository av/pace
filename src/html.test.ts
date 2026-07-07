import { describe, test, expect } from "bun:test";
import {
  decodeHtmlEntities,
  decodeNumericFeedTitle,
  decodeNumericFeedTitleOptional,
  stripHtml,
} from "./adapters/html";

describe("decodeHtmlEntities", () => {
  test("decodes common named entities", () => {
    expect(decodeHtmlEntities("&lt;b&gt; &quot;x&quot; &apos;y&apos; &#39;z&#39;")).toBe(
      "<b> \"x\" 'y' 'z'",
    );
    expect(decodeHtmlEntities("&amp; &nbsp; end")).toBe("&   end");
  });

  test("leaves decimal and hex entities unchanged without numeric option", () => {
    expect(decodeHtmlEntities("&#65; &#x41;")).toBe("&#65; &#x41;");
  });

  test("decodes decimal and hex entities when numeric is true", () => {
    expect(decodeHtmlEntities("&#65; &#x41;", { numeric: true })).toBe("A A");
    expect(decodeHtmlEntities("&#8364;", { numeric: true })).toBe("€");
  });

  test("decodes astral-plane code points as real characters, not lone surrogates", () => {
    expect(decodeHtmlEntities("&#128169;", { numeric: true })).toBe("\u{1F4A9}");
    expect(decodeHtmlEntities("&#x1F600;", { numeric: true })).toBe("\u{1F600}");
    expect(decodeHtmlEntities("&#X1F600;", { numeric: true })).toBe("\u{1F600}");
  });

  test("passes invalid numeric references through as literal text", () => {
    expect(decodeHtmlEntities("&#x110000;", { numeric: true })).toBe("&#x110000;");
    expect(decodeHtmlEntities("&#55296;", { numeric: true })).toBe("&#55296;"); // surrogate
    expect(decodeHtmlEntities("&#0;", { numeric: true })).toBe("&#0;");
    expect(decodeHtmlEntities("&#999999999999;", { numeric: true })).toBe(
      "&#999999999999;",
    );
  });

  test("does not double-decode escaped entities", () => {
    expect(decodeHtmlEntities("&#38;lt;", { numeric: true })).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeHtmlEntities("&amp;amp;")).toBe("&amp;");
    expect(decodeHtmlEntities("&#38;#60;script&#38;#62;", { numeric: true })).toBe(
      "&#60;script&#62;",
    );
  });

  test("leaves unknown named entities untouched", () => {
    expect(decodeHtmlEntities("&notarealentity; &bogus;")).toBe(
      "&notarealentity; &bogus;",
    );
  });

  test("nbsp is case-insensitive, other named entities are not", () => {
    expect(decodeHtmlEntities("&NBSP;&Nbsp;")).toBe("  ");
    expect(decodeHtmlEntities("&LT;&AMP;")).toBe("&LT;&AMP;");
  });

  test("decodes typographic entities common in feed titles", () => {
    expect(decodeHtmlEntities("Rust &mdash; it&rsquo;s fast&hellip;")).toBe(
      "Rust — it’s fast…",
    );
    expect(decodeHtmlEntities("&ldquo;Hi&rdquo; &lsquo;there&rsquo;")).toBe(
      "“Hi” ‘there’",
    );
    expect(decodeHtmlEntities("2019&ndash;2026")).toBe("2019–2026");
    expect(decodeHtmlEntities("&laquo;quote&raquo; &bull; &middot;")).toBe(
      "«quote» • ·",
    );
  });

  test("decodes symbol and currency entities", () => {
    expect(decodeHtmlEntities("Acme&trade; &copy; &reg;")).toBe("Acme™ © ®");
    expect(decodeHtmlEntities("20&deg;C &plusmn;2 3&times;4 8&divide;2")).toBe(
      "20°C ±2 3×4 8÷2",
    );
    expect(decodeHtmlEntities("&euro;5 &pound;3 &yen;100 &cent;99")).toBe(
      "€5 £3 ¥100 ¢99",
    );
    expect(decodeHtmlEntities("&frac12; &frac14; &frac34; &permil;")).toBe(
      "½ ¼ ¾ ‰",
    );
  });

  test("typographic entity names are case-sensitive; Dagger/Prime differ from lowercase", () => {
    expect(decodeHtmlEntities("&dagger;&Dagger;")).toBe("†‡");
    expect(decodeHtmlEntities("&prime;&Prime;")).toBe("′″");
    expect(decodeHtmlEntities("&MDASH;&Mdash;")).toBe("&MDASH;&Mdash;");
  });
});

describe("decodeNumericFeedTitle", () => {
  test("decodes named and numeric entities in feed titles", () => {
    expect(decodeNumericFeedTitle("A &amp; B &#8364; C")).toBe("A & B € C");
  });

  test("decodeNumericFeedTitleOptional uses fallback for missing text", () => {
    expect(decodeNumericFeedTitleOptional()).toBe("(untitled)");
    expect(decodeNumericFeedTitleOptional(undefined, "no title")).toBe("no title");
  });
});

describe("stripHtml", () => {
  test("removes tags and decodes named entities by default", () => {
    expect(stripHtml("<p>Hello &amp; <b>world</b></p>")).toBe("Hello & world");
  });

  test("blockBreaks turns br and closing p into newlines", () => {
    expect(stripHtml("<p>one<br/>two</p>three", { blockBreaks: true })).toBe(
      "one\ntwo\nthree",
    );
  });

  test("whitespace preserve keeps internal spacing without collapse", () => {
    expect(stripHtml("  a   b  ", { whitespace: "preserve" })).toBe("a   b");
    expect(stripHtml("a\n\n\n\nb", { whitespace: "preserve" })).toBe("a\n\n\n\nb");
  });

  test("whitespace collapse-newlines caps consecutive newlines", () => {
    expect(stripHtml("a\n\n\n\nb", { whitespace: "collapse-newlines" })).toBe(
      "a\n\nb",
    );
  });

  test("whitespace collapse-all collapses all whitespace", () => {
    expect(stripHtml("  a \n\n  b  ", { whitespace: "collapse-all" })).toBe("a b");
  });

  test("tagSeparator inserts between former tags", () => {
    expect(stripHtml("<span>a</span><span>b</span>", { tagSeparator: " " })).toBe(
      "a  b",
    );
  });

  test("strips empty and malformed tags consistently regardless of tagSeparator", () => {
    const html = "a<>b<//>c";
    expect(stripHtml(html)).toBe("abc");
    expect(stripHtml(html, { tagSeparator: " " })).toBe("a b c");
  });

  test("numericEntities decodes numeric references in stripped text", () => {
    expect(stripHtml("<p>&#65;</p>", { numericEntities: true })).toBe("A");
    expect(stripHtml("<p>&#65;</p>", { numericEntities: false })).toBe("&#65;");
  });
});