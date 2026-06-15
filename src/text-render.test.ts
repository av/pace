import { describe, test, expect } from "bun:test";
import { sanitize, renderMarkdown } from "./layout/text-render";

describe("text-render", () => {
  describe("sanitize", () => {
    test("allows basic formatting tags", () => {
      const input = "<p>Hello <strong>world</strong> <em>italic</em></p>";
      expect(sanitize(input)).toBe(input);
    });

    test("allows links with href, target, rel", () => {
      const input = '<a href="https://example.com" target="_blank" rel="noopener">link</a>';
      expect(sanitize(input)).toBe(input);
    });

    test("allows images with src and alt", () => {
      const input = '<img src="https://example.com/img.png" alt="photo" />';
      const result = sanitize(input);
      expect(result).toContain('src="https://example.com/img.png"');
      expect(result).toContain('alt="photo"');
    });

    test("allows headings h1-h6", () => {
      for (let i = 1; i <= 6; i++) {
        const input = `<h${i}>Title</h${i}>`;
        expect(sanitize(input)).toBe(input);
      }
    });

    test("allows lists", () => {
      const input = "<ul><li>one</li><li>two</li></ul>";
      expect(sanitize(input)).toBe(input);
    });

    test("allows pre, code, blockquote", () => {
      expect(sanitize("<pre><code>x = 1</code></pre>")).toContain("<pre>");
      expect(sanitize("<blockquote>quote</blockquote>")).toContain("<blockquote>");
    });

    test("allows details and summary", () => {
      const input = "<details><summary>More</summary><p>content</p></details>";
      expect(sanitize(input)).toBe(input);
    });

    // XSS prevention tests
    test("strips script tags", () => {
      const input = '<p>Hello</p><script>alert("xss")</script><p>world</p>';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).toContain("<p>Hello</p>");
      expect(result).toContain("<p>world</p>");
    });

    test("strips event handlers", () => {
      const input = '<img src="x.png" onerror="alert(1)" />';
      const result = sanitize(input);
      expect(result).not.toContain("onerror");
      expect(result).toContain("src");
    });

    test("strips javascript: URIs from links", () => {
      const input = '<a href="javascript:alert(1)">click</a>';
      const result = sanitize(input);
      expect(result).not.toContain("javascript:");
    });

    test("strips javascript: URIs from images", () => {
      const input = '<img src="javascript:alert(1)" />';
      const result = sanitize(input);
      expect(result).not.toContain("javascript:");
    });

    test("strips data: URIs from images", () => {
      const input = '<img src="data:text/html,<script>alert(1)</script>" />';
      const result = sanitize(input);
      expect(result).not.toContain("data:");
    });

    test("strips onclick from div", () => {
      const input = '<div onclick="alert(1)">click me</div>';
      const result = sanitize(input);
      expect(result).not.toContain("onclick");
    });

    test("strips style tags", () => {
      const input = "<style>body { display: none; }</style><p>visible</p>";
      const result = sanitize(input);
      expect(result).not.toContain("<style");
      expect(result).toContain("<p>visible</p>");
    });

    test("strips iframe tags", () => {
      const input = '<iframe src="https://evil.com"></iframe><p>safe</p>';
      const result = sanitize(input);
      expect(result).not.toContain("<iframe");
      expect(result).toContain("<p>safe</p>");
    });

    test("allows http and https schemes only", () => {
      expect(sanitize('<a href="https://example.com">ok</a>')).toContain("https://example.com");
      expect(sanitize('<a href="http://example.com">ok</a>')).toContain("http://example.com");
      expect(sanitize('<a href="ftp://example.com">no</a>')).not.toContain("ftp:");
    });
  });

  describe("renderMarkdown", () => {
    test("renders basic markdown", () => {
      const result = renderMarkdown("**bold** and *italic*");
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>italic</em>");
    });

    test("renders headings", () => {
      const result = renderMarkdown("## Heading");
      expect(result).toContain("<h2");
      expect(result).toContain("Heading");
    });

    test("renders lists", () => {
      const result = renderMarkdown("- item one\n- item two");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>item one</li>");
      expect(result).toContain("<li>item two</li>");
    });

    test("renders links", () => {
      const result = renderMarkdown("[link](https://example.com)");
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain("link</a>");
    });

    test("renders code blocks", () => {
      const result = renderMarkdown("```\nconst x = 1;\n```");
      expect(result).toContain("<pre>");
      expect(result).toContain("<code>");
    });

    test("sanitizes XSS in markdown output", () => {
      const result = renderMarkdown('Click <script>alert("xss")</script> here');
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    test("sanitizes javascript: links in markdown", () => {
      const result = renderMarkdown('[click](javascript:alert(1))');
      expect(result).not.toContain("javascript:");
    });

    test("renders blockquotes", () => {
      const result = renderMarkdown("> a quote");
      expect(result).toContain("<blockquote>");
    });

    test("renders inline code", () => {
      const result = renderMarkdown("use `console.log`");
      expect(result).toContain("<code>console.log</code>");
    });

    test("renders GFM task lists as text (input not in allowlist)", () => {
      const result = renderMarkdown("- [x] Done\n- [ ] Todo");
      // Checkbox inputs are stripped by sanitizer, but list content remains
      expect(result).not.toContain("<input");
      expect(result).toContain("Done");
      expect(result).toContain("Todo");
      expect(result).toContain("<li>");
    });
  });

  describe("edge cases", () => {
    test("sanitize handles empty string", () => {
      expect(sanitize("")).toBe("");
    });

    test("sanitize handles very long markdown-like HTML (1000+ chars)", () => {
      const parts: string[] = [];
      for (let i = 0; i < 50; i++) {
        parts.push(`<h2>Section ${i}</h2><p>Paragraph ${i} with <strong>bold</strong> and <em>italic</em>.</p>`);
      }
      const input = parts.join("\n");
      expect(input.length).toBeGreaterThan(1000);
      const result = sanitize(input);
      expect(result).toContain("<h2>Section 0</h2>");
      expect(result).toContain("<h2>Section 49</h2>");
      expect(result).toContain("<strong>bold</strong>");
    });

    test("sanitize strips deeply nested disallowed tags", () => {
      const input = "<p><strong><em><code>text</code></em></strong></p>";
      const result = sanitize(input);
      // All these tags are allowed, so they should be preserved
      expect(result).toBe(input);
    });

    test("sanitize strips disallowed tags in deeply nested allowed tags", () => {
      const input = '<p><strong><em><span onclick="x"><code>text</code></span></em></strong></p>';
      const result = sanitize(input);
      expect(result).not.toContain("<span");
      expect(result).not.toContain("onclick");
      expect(result).toContain("<code>text</code>");
    });

  });

  describe("advanced XSS bypass vectors", () => {
    test("CSS-based javascript URL in style (background:url)", () => {
      const input = '<div style="background:url(javascript:alert(1))">test</div>';
      const result = sanitize(input);
      // div is not in allowlist, so the tag is discarded
      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("background");
      expect(result).toContain("test");
    });

    test("SVG with foreignObject and embedded script", () => {
      const input = '<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>';
      const result = sanitize(input);
      expect(result).not.toContain("<svg");
      expect(result).not.toContain("<foreignObject");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    test("MathML with embedded style tag", () => {
      const input = '<math><mtext><table><mglyph><style>img{background:url(evil.com)}</style></mglyph></table></mtext></math>';
      const result = sanitize(input);
      expect(result).not.toContain("<math");
      expect(result).not.toContain("<style");
      expect(result).not.toContain("background");
    });

    test("null bytes in attribute values", () => {
      const input = '<a href="java\x00script:alert(1)">click</a>';
      const result = sanitize(input);
      expect(result).not.toContain("javascript:");
      // href should be stripped or safe
      if (result.includes("href")) {
        expect(result).not.toMatch(/href\s*=\s*["']?java/i);
      }
    });

    test("double-encoded content is treated as text", () => {
      const input = "%253Cscript%253Ealert(1)%253C/script%253E";
      const result = sanitize(input);
      // Double-encoded strings should pass through as harmless text
      expect(result).not.toContain("<script");
      // The percent-encoded text stays as literal text
      expect(result).toContain("%253C");
    });

    test("comment-based script bypass", () => {
      const input = '<!--><script>alert(1)-->';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).not.toContain("<!--");
    });

    test("CDATA section with script", () => {
      const input = '<![CDATA[<script>alert(1)</script>]]>';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert(1)");
    });

    test("template tag with script", () => {
      const input = '<template><script>alert(1)</script></template>';
      const result = sanitize(input);
      expect(result).not.toContain("<template");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    test("noscript tag with script", () => {
      const input = '<noscript><script>alert(1)</script></noscript>';
      const result = sanitize(input);
      expect(result).not.toContain("<noscript");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    test("mixed-case tag bypass attempt", () => {
      const input = '<ScRiPt>alert(1)</ScRiPt>';
      const result = sanitize(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("<ScRiPt");
      expect(result).not.toContain("alert");
    });

    test("SVG onload event handler", () => {
      const input = '<svg onload="alert(1)"><circle r="10"/></svg>';
      const result = sanitize(input);
      expect(result).not.toContain("<svg");
      expect(result).not.toContain("onload");
      expect(result).not.toContain("alert");
    });

    test("object tag with data attribute", () => {
      const input = '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">test</object>';
      const result = sanitize(input);
      expect(result).not.toContain("<object");
      expect(result).not.toContain("data:");
    });

    test("embed tag", () => {
      const input = '<embed src="https://evil.com/xss.swf">';
      const result = sanitize(input);
      expect(result).not.toContain("<embed");
    });

    test("base tag to hijack relative URLs", () => {
      const input = '<base href="https://evil.com/"><a href="/path">link</a>';
      const result = sanitize(input);
      expect(result).not.toContain("<base");
      expect(result).not.toContain("evil.com");
    });

    test("form tag with action", () => {
      const input = '<form action="https://evil.com"><input type="submit"></form>';
      const result = sanitize(input);
      expect(result).not.toContain("<form");
      expect(result).not.toContain("<input");
      expect(result).not.toContain("evil.com");
    });

    test("meta refresh redirect", () => {
      const input = '<meta http-equiv="refresh" content="0;url=https://evil.com">';
      const result = sanitize(input);
      expect(result).not.toContain("<meta");
      expect(result).not.toContain("evil.com");
    });

    test("style attribute on allowed tag (p)", () => {
      // Even on allowed tags, style attribute is not in the allowlist
      const input = '<p style="background:url(javascript:alert(1))">text</p>';
      const result = sanitize(input);
      expect(result).not.toContain("style");
      expect(result).not.toContain("javascript:");
      expect(result).toContain("<p>text</p>");
    });

    test("data attributes on allowed tags", () => {
      const input = '<p data-exploit="alert(1)">text</p>';
      const result = sanitize(input);
      expect(result).not.toContain("data-exploit");
      expect(result).toContain("<p>text</p>");
    });

    test("vbscript scheme in href", () => {
      const input = '<a href="vbscript:MsgBox(1)">click</a>';
      const result = sanitize(input);
      expect(result).not.toContain("vbscript:");
    });

    test("tab and newline in javascript URI", () => {
      const input = '<a href="java\tscri\npt:alert(1)">click</a>';
      const result = sanitize(input);
      expect(result).not.toContain("javascript:");
      // The href should not contain any variant of javascript
      if (result.includes("href")) {
        expect(result).not.toMatch(/java.*script/i);
      }
    });

    test("HTML entities in script tag name", () => {
      const input = '&lt;script&gt;alert(1)&lt;/script&gt;';
      const result = sanitize(input);
      // These are entity-encoded so they should appear as text, not as tags
      expect(result).not.toContain("<script");
      // The text content is safe (displayed as literal angle brackets)
      expect(result).toContain("&lt;script&gt;");
    });

    test("multiple chained vectors in one payload", () => {
      const input = [
        '<p>safe</p>',
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(2)>',
        '<svg onload=alert(3)>',
        '<a href="javascript:alert(4)">click</a>',
        '<style>*{background:url(evil)}</style>',
        '<p>also safe</p>',
      ].join("");
      const result = sanitize(input);
      expect(result).toContain("<p>safe</p>");
      expect(result).toContain("<p>also safe</p>");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("<svg");
      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("<style");
    });

    test("markdown rendering of XSS via image with onerror", () => {
      // Malformed image markdown is not parsed as an img tag by marked;
      // it becomes plain text inside a <p>. The literal "onerror" appears
      // in text content only, never as an attribute on any element.
      const md = '![alt](x" onerror="alert(1))';
      const result = renderMarkdown(md);
      // No img tag should be generated from this malformed syntax
      expect(result).not.toContain("<img");
      // The content is safely rendered as text in a <p>
      expect(result).toContain("<p>");
    });

    test("markdown rendering of XSS via link title", () => {
      const md = '[link](https://ok.com "onmouseover=alert(1)")';
      const result = renderMarkdown(md);
      expect(result).not.toContain("onmouseover");
      // title attribute is not in the allowlist for a tags
      expect(result).not.toContain("alert");
    });
  });
});
