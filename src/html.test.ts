import { describe, test, expect } from "bun:test";
import { decodeHtmlEntities, stripHtml } from "./adapters/html";

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