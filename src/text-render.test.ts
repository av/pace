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

    test("renders GFM tables as text (tables not in allowlist)", () => {
      const result = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
      // Table tags are stripped by sanitizer, content remains
      expect(result).not.toContain("<table");
      expect(result).toContain("A");
      expect(result).toContain("B");
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

    test("renders nested blockquotes", () => {
      const result = renderMarkdown("> outer\n>> inner\n>>> deeply nested");
      expect(result).toContain("<blockquote>");
      // Should have nested blockquote elements
      const count = (result.match(/<blockquote>/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(2);
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

    test("renderMarkdown strips raw HTML script in markdown", () => {
      const result = renderMarkdown("## Title\n<script>alert(1)</script>\nText");
      expect(result).toContain("<h2");
      expect(result).toContain("Title");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
      expect(result).toContain("Text");
    });

    test("renderMarkdown handles GFM table (tags stripped, content preserved)", () => {
      const md = "| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |";
      const result = renderMarkdown(md);
      expect(result).not.toContain("<table");
      expect(result).not.toContain("<thead");
      expect(result).not.toContain("<tbody");
      expect(result).not.toContain("<tr");
      expect(result).not.toContain("<td");
      expect(result).not.toContain("<th");
      // Content should still be present as text
      expect(result).toContain("Alice");
      expect(result).toContain("Bob");
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

    test("renderMarkdown with very long content (many headings and lists)", () => {
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(`### Heading ${i}`);
        lines.push(`- Item ${i}a`);
        lines.push(`- Item ${i}b`);
        lines.push("");
      }
      const md = lines.join("\n");
      expect(md.length).toBeGreaterThan(1000);
      const result = renderMarkdown(md);
      expect(result).toContain("<h3>");
      expect(result).toContain("<li>");
      expect(result).toContain("Heading 0");
      expect(result).toContain("Heading 99");
    });

    test("renderMarkdown handles nested blockquotes", () => {
      const md = "> Level 1\n>> Level 2\n>>> Level 3";
      const result = renderMarkdown(md);
      const count = (result.match(/<blockquote>/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(2);
      expect(result).toContain("Level 1");
      expect(result).toContain("Level 3");
    });
  });
});
