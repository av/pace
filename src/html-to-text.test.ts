import { describe, test, expect } from "bun:test";
import { htmlToText } from "./html-to-text";

describe("htmlToText", () => {
  test("strips simple tags", () => {
    expect(htmlToText("<p>Hello <b>world</b></p>")).toBe("Hello world");
  });

  test("discards script tag and its contents", () => {
    expect(htmlToText('<p>Text</p><script>alert("x")</script><p>After</p>')).toBe("Text After");
  });

  test("discards style tag and its contents", () => {
    expect(htmlToText("<style>body{color:red}</style><p>Visible</p>")).toBe("Visible");
  });

  test("discards nav tag and its contents", () => {
    expect(htmlToText("<nav><a>Menu</a></nav><main>Content</main>")).toBe("Content");
  });

  test("collapses whitespace", () => {
    expect(htmlToText("<p>  foo   \n\t  bar  </p>")).toBe("foo bar");
  });

  test("decodes common HTML entities", () => {
    // &nbsp; becomes a space; whitespace collapse merges adjacent spaces
    expect(htmlToText("&amp; &lt; &gt; &quot; &#039;")).toBe("& < > \" '");
    expect(htmlToText("hello&nbsp;world")).toBe("hello world");
  });

  test("returns plain text unchanged (no tags)", () => {
    expect(htmlToText("Hello world")).toBe("Hello world");
  });

  test("handles empty string", () => {
    expect(htmlToText("")).toBe("");
  });

  test("handles self-closing tags", () => {
    expect(htmlToText("<img src='x'/> text <br/> more")).toBe("text more");
  });

  test("strips nested structure to readable text", () => {
    const html = `
      <html><head><style>h1{font-size:2em}</style></head>
      <body>
        <nav><ul><li>Home</li></ul></nav>
        <article><h1>Title</h1><p>Body text here.</p></article>
      </body></html>`;
    const result = htmlToText(html);
    expect(result).toContain("Title");
    expect(result).toContain("Body text here.");
    expect(result).not.toContain("font-size");
    expect(result).not.toContain("Home");
  });
});
