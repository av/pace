import { describe, test, expect } from "bun:test";
import { sanitize, renderMarkdown } from "./layout/text-render";

// =============================================================================
// COMPLEX MARKDOWN CONTENT
// =============================================================================
describe("complex markdown content", () => {
  describe("GFM tables", () => {
    test("table tags are preserved with all cell content", () => {
      const md = [
        "| Name | Age | City |",
        "|------|-----|------|",
        "| Alice | 30 | NYC |",
        "| Bob | 25 | LA |",
        "| Charlie | 35 | CHI |",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("<table");
      expect(result).toContain("<thead");
      expect(result).toContain("<tbody");
      expect(result).toContain("<tr");
      expect(result).toContain("<td");
      expect(result).toContain("<th");
      for (const name of ["Alice", "Bob", "Charlie"]) {
        expect(result).toContain(name);
      }
      for (const city of ["NYC", "LA", "CHI"]) {
        expect(result).toContain(city);
      }
    });

    test("table with alignment markers preserves content", () => {
      const md = [
        "| Left | Center | Right |",
        "|:-----|:------:|------:|",
        "| L1   |   C1   |    R1 |",
        "| L2   |   C2   |    R2 |",
      ].join("\n");
      const result = renderMarkdown(md);
      // Alignment columns are GFM syntax; tags stripped, content stays
      expect(result).toContain("Left");
      expect(result).toContain("Center");
      expect(result).toContain("Right");
      expect(result).toContain("L1");
      expect(result).toContain("R2");
    });

    test("table with inline formatting in cells", () => {
      const md = [
        "| Feature | Status |",
        "|---------|--------|",
        "| **Bold** | *Done* |",
        "| `code` | ~~removed~~ |",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("<strong>Bold</strong>");
      expect(result).toContain("<em>Done</em>");
      expect(result).toContain("<code>code</code>");
    });

    test("single-row table preserves header content", () => {
      const md = "| Solo |\n|------|\n| only |";
      const result = renderMarkdown(md);
      expect(result).toContain("Solo");
      expect(result).toContain("only");
    });
  });

  describe("task lists", () => {
    test("checked and unchecked tasks render as list items without checkboxes", () => {
      const md = "- [x] Buy milk\n- [ ] Write tests\n- [x] Ship feature";
      const result = renderMarkdown(md);
      expect(result).toContain("<li>");
      expect(result).toContain("Buy milk");
      expect(result).toContain("Write tests");
      expect(result).toContain("Ship feature");
      // Input checkboxes are stripped
      expect(result).not.toContain("<input");
    });

    test("task list mixed with regular list items", () => {
      const md = "- Regular item\n- [x] Checked task\n- [ ] Unchecked task\n- Another regular";
      const result = renderMarkdown(md);
      expect(result).toContain("Regular item");
      expect(result).toContain("Checked task");
      expect(result).toContain("Unchecked task");
      expect(result).toContain("Another regular");
    });

    test("nested task list", () => {
      const md = "- [ ] Parent task\n  - [x] Child done\n  - [ ] Child pending";
      const result = renderMarkdown(md);
      expect(result).toContain("Parent task");
      expect(result).toContain("Child done");
      expect(result).toContain("Child pending");
    });
  });

  describe("fenced code blocks with language tags", () => {
    test("typescript code block with language class", () => {
      const md = '```typescript\ninterface User {\n  name: string;\n  age: number;\n}\n```';
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code");
      expect(result).toContain("interface User");
      expect(result).toContain("name: string;");
    });

    test("yaml code block preserves indentation structure", () => {
      const md = "```yaml\nserver:\n  port: 3000\n  host: localhost\n```";
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code");
      expect(result).toContain("server:");
      expect(result).toContain("port: 3000");
    });

    test("python code block", () => {
      const md = '```python\ndef hello():\n    print("hello world")\n```';
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code");
      expect(result).toContain("def hello():");
    });

    test("code block without language tag", () => {
      const md = "```\nplain code\n```";
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code>");
      expect(result).toContain("plain code");
    });

    test("code block with HTML-like content is escaped", () => {
      const md = '```html\n<div class="container">\n  <p>Hello</p>\n</div>\n```';
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      // The HTML inside code blocks should be escaped, not rendered
      expect(result).toContain("&lt;div");
      expect(result).toContain("&lt;p&gt;Hello&lt;/p&gt;");
    });

    test("multiple code blocks with different languages", () => {
      const md = [
        "```js",
        "const x = 1;",
        "```",
        "",
        "```css",
        "body { color: red; }",
        "```",
      ].join("\n");
      const result = renderMarkdown(md);
      const preCount = (result.match(/<pre>/g) || []).length;
      expect(preCount).toBe(2);
      expect(result).toContain("const x = 1;");
      expect(result).toContain("body { color: red; }");
    });
  });

  describe("footnotes", () => {
    test("footnote reference and definition render as text", () => {
      // GFM does not support footnotes natively in marked (unless extension added)
      // The raw syntax should appear as text content
      const md = "Here is a claim[^1].\n\n[^1]: The source for the claim.";
      const result = renderMarkdown(md);
      // Content should be present regardless of footnote rendering
      expect(result).toContain("Here is a claim");
      expect(result).toContain("The source for the claim");
    });

    test("multiple footnotes", () => {
      const md = "Point A[^a] and point B[^b].\n\n[^a]: Source A.\n[^b]: Source B.";
      const result = renderMarkdown(md);
      expect(result).toContain("Point A");
      expect(result).toContain("point B");
      expect(result).toContain("Source A");
      expect(result).toContain("Source B");
    });
  });

  describe("strikethrough", () => {
    test("GFM strikethrough with double tildes", () => {
      const md = "This is ~~deleted~~ text.";
      const result = renderMarkdown(md);
      // <del> tag is not in allowlist, so it gets stripped
      // but the text content should remain
      expect(result).toContain("deleted");
      expect(result).toContain("text");
    });

    test("strikethrough combined with other formatting", () => {
      const md = "**bold** and ~~struck~~ and *italic*";
      const result = renderMarkdown(md);
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>italic</em>");
      expect(result).toContain("struck");
    });

    test("strikethrough tag (del) is not in allowlist", () => {
      const html = "<del>removed</del>";
      const result = sanitize(html);
      expect(result).not.toContain("<del");
      expect(result).toContain("removed");
    });
  });

  describe("autolinked URLs", () => {
    test("bare HTTPS URL becomes a clickable link", () => {
      const md = "Visit https://example.com for info.";
      const result = renderMarkdown(md);
      expect(result).toContain('<a href="https://example.com"');
      expect(result).toContain("https://example.com");
    });

    test("bare HTTP URL becomes a clickable link", () => {
      const md = "See http://example.org/page for details.";
      const result = renderMarkdown(md);
      expect(result).toContain('<a href="http://example.org/page"');
    });

    test("URL with path and query params is autolinked", () => {
      const md = "Check https://api.example.com/v2/data?key=val&limit=10 now.";
      const result = renderMarkdown(md);
      expect(result).toContain("href=");
      expect(result).toContain("api.example.com");
    });

    test("email-like text is not autolinked as http", () => {
      const md = "Contact user@example.com for help.";
      const result = renderMarkdown(md);
      // mailto: is not in allowedSchemes, so if autolinked it should be stripped
      expect(result).not.toContain("mailto:");
      expect(result).toContain("user@example.com");
    });
  });

  describe("mixed lists (numbered inside bulleted and vice versa)", () => {
    test("ordered list inside unordered list", () => {
      const md = [
        "- Fruits",
        "  1. Apple",
        "  2. Banana",
        "- Vegetables",
        "  1. Carrot",
        "  2. Pea",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("<ul>");
      expect(result).toContain("<ol>");
      expect(result).toContain("Apple");
      expect(result).toContain("Banana");
      expect(result).toContain("Carrot");
      expect(result).toContain("Pea");
    });

    test("unordered list inside ordered list", () => {
      const md = [
        "1. Step one",
        "   - Detail A",
        "   - Detail B",
        "2. Step two",
        "   - Detail C",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("<ol>");
      expect(result).toContain("<ul>");
      expect(result).toContain("Step one");
      expect(result).toContain("Detail A");
      expect(result).toContain("Step two");
      expect(result).toContain("Detail C");
    });

    test("three-level nested mixed list", () => {
      const md = [
        "- Level 1",
        "  1. Level 2 ordered",
        "     - Level 3 unordered",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("<ul>");
      expect(result).toContain("<ol>");
      expect(result).toContain("Level 1");
      expect(result).toContain("Level 2 ordered");
      expect(result).toContain("Level 3 unordered");
    });
  });

  describe("blockquotes with multiple paragraphs and nested quotes", () => {
    test("blockquote with multiple paragraphs", () => {
      const md = "> First paragraph of the quote.\n>\n> Second paragraph of the quote.";
      const result = renderMarkdown(md);
      expect(result).toContain("<blockquote>");
      expect(result).toContain("First paragraph");
      expect(result).toContain("Second paragraph");
    });

    test("nested blockquotes (three levels)", () => {
      const md = "> Level one\n>> Level two\n>>> Level three";
      const result = renderMarkdown(md);
      const bqCount = (result.match(/<blockquote>/g) || []).length;
      expect(bqCount).toBeGreaterThanOrEqual(2);
      expect(result).toContain("Level one");
      expect(result).toContain("Level two");
      expect(result).toContain("Level three");
    });

    test("blockquote with formatted content inside", () => {
      const md = "> **Bold quote** with *emphasis* and `code`.";
      const result = renderMarkdown(md);
      expect(result).toContain("<blockquote>");
      expect(result).toContain("<strong>Bold quote</strong>");
      expect(result).toContain("<em>emphasis</em>");
      expect(result).toContain("<code>code</code>");
    });

    test("blockquote with a list inside", () => {
      const md = "> Items:\n> - one\n> - two\n> - three";
      const result = renderMarkdown(md);
      expect(result).toContain("<blockquote>");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>one</li>");
    });

    test("blockquote with code block inside", () => {
      const md = "> Example:\n>\n> ```\n> code here\n> ```";
      const result = renderMarkdown(md);
      expect(result).toContain("<blockquote>");
      // The code block may or may not render inside blockquote depending on parser
      expect(result).toContain("code here");
    });
  });

  describe("horizontal rules", () => {
    test("triple dash horizontal rule", () => {
      const md = "Above\n\n---\n\nBelow";
      const result = renderMarkdown(md);
      expect(result).toContain("<hr");
      expect(result).toContain("Above");
      expect(result).toContain("Below");
    });

    test("triple asterisk horizontal rule", () => {
      const md = "Before\n\n***\n\nAfter";
      const result = renderMarkdown(md);
      expect(result).toContain("<hr");
    });

    test("triple underscore horizontal rule", () => {
      const md = "Top\n\n___\n\nBottom";
      const result = renderMarkdown(md);
      expect(result).toContain("<hr");
    });

    test("multiple horizontal rules in document", () => {
      const md = "Section 1\n\n---\n\nSection 2\n\n***\n\nSection 3";
      const result = renderMarkdown(md);
      const hrCount = (result.match(/<hr/g) || []).length;
      expect(hrCount).toBe(2);
      expect(result).toContain("Section 1");
      expect(result).toContain("Section 2");
      expect(result).toContain("Section 3");
    });
  });

  describe("inline HTML mixed with markdown", () => {
    test("allowed HTML tags mixed with markdown formatting", () => {
      const md = "This is **bold** and <em>inline HTML italic</em> together.";
      const result = renderMarkdown(md);
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>inline HTML italic</em>");
    });

    test("disallowed HTML tags are stripped, markdown still renders", () => {
      const md = "# Title\n\n<div>wrapper</div>\n\n**bold text**";
      const result = renderMarkdown(md);
      expect(result).toContain("<h1");
      expect(result).toContain("<strong>bold text</strong>");
      expect(result).not.toContain("<div");
      expect(result).toContain("wrapper");
    });

    test("HTML details/summary inside markdown", () => {
      const md = "# FAQ\n\n<details><summary>Question?</summary>\n\nAnswer here.\n\n</details>";
      const result = renderMarkdown(md);
      expect(result).toContain("<h1");
      expect(result).toContain("<details>");
      expect(result).toContain("<summary>Question?</summary>");
      expect(result).toContain("Answer here");
    });

    test("inline HTML with disallowed attributes", () => {
      const md = 'Click <a href="https://ok.com" onclick="evil()">here</a>.';
      const result = renderMarkdown(md);
      expect(result).toContain('<a href="https://ok.com"');
      expect(result).not.toContain("onclick");
    });

    test("HTML br mixed with markdown paragraphs", () => {
      const md = "Line one<br>Line two\n\nNew paragraph.";
      const result = renderMarkdown(md);
      expect(result).toContain("<br");
      expect(result).toContain("Line one");
      expect(result).toContain("Line two");
      expect(result).toContain("New paragraph");
    });
  });
});

// =============================================================================
// HTML SANITIZATION WITH REAL-WORLD CONTENT
// =============================================================================
describe("HTML sanitization with real-world content", () => {
  describe("realistic blog post HTML", () => {
    test("blog post with multiple paragraphs, images, links, headings", () => {
      const blogPost = [
        '<h1>Building a Dashboard</h1>',
        '<p>In this post we explore how to build a <strong>real-time</strong> dashboard.</p>',
        '<img src="https://example.com/hero.jpg" alt="Dashboard screenshot" />',
        '<h2>Getting Started</h2>',
        '<p>First, install the <a href="https://example.com/docs" target="_blank" rel="noopener">CLI tool</a>.</p>',
        '<p>Then run <code>npm install</code> to set up dependencies.</p>',
        '<h3>Configuration</h3>',
        '<pre><code>server:\n  port: 8080</code></pre>',
        '<blockquote><p>Pro tip: always use HTTPS in production.</p></blockquote>',
        '<p>Here is a list of features:</p>',
        '<ul>',
        '  <li>Real-time updates</li>',
        '  <li>Responsive layout</li>',
        '  <li>Dark mode</li>',
        '</ul>',
        '<hr />',
        '<p>That concludes the guide. Happy building!</p>',
      ].join("\n");
      const result = sanitize(blogPost);
      // All allowed tags are preserved
      expect(result).toContain("<h1>Building a Dashboard</h1>");
      expect(result).toContain("<h2>Getting Started</h2>");
      expect(result).toContain("<h3>Configuration</h3>");
      expect(result).toContain("<strong>real-time</strong>");
      expect(result).toContain('<img src="https://example.com/hero.jpg"');
      expect(result).toContain('alt="Dashboard screenshot"');
      expect(result).toContain('<a href="https://example.com/docs"');
      expect(result).toContain("<code>npm install</code>");
      expect(result).toContain("<pre>");
      expect(result).toContain("<blockquote>");
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>Real-time updates</li>");
      expect(result).toContain("<hr");
    });

    test("blog post with disallowed wrapper divs stripped cleanly", () => {
      const html = [
        '<div class="post-container">',
        '  <div class="post-body">',
        '    <h2>Title</h2>',
        '    <p>Content with <strong>emphasis</strong>.</p>',
        '  </div>',
        '  <div class="sidebar">',
        '    <p>Related links</p>',
        '  </div>',
        '</div>',
      ].join("\n");
      const result = sanitize(html);
      expect(result).not.toContain("<div");
      expect(result).not.toContain("class=");
      expect(result).toContain("<h2>Title</h2>");
      expect(result).toContain("<strong>emphasis</strong>");
      expect(result).toContain("Related links");
    });
  });

  describe("GitHub-style markdown HTML", () => {
    test("GitHub code block HTML preserves pre/code", () => {
      const html = [
        '<pre><code class="language-typescript">',
        'const x: number = 42;',
        'console.log(x);',
        '</code></pre>',
      ].join("\n");
      const result = sanitize(html);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code>");
      // class attribute is stripped (not in allowedAttributes for code)
      expect(result).not.toContain("class=");
      expect(result).toContain("const x: number = 42;");
    });

    test("GitHub alert/note callout (div-based) stripped but content preserved", () => {
      const html = [
        '<div class="markdown-alert markdown-alert-note">',
        '<p class="markdown-alert-title">Note</p>',
        '<p>This is an important note about configuration.</p>',
        '</div>',
      ].join("");
      const result = sanitize(html);
      expect(result).not.toContain("<div");
      expect(result).not.toContain("class=");
      expect(result).toContain("Note");
      expect(result).toContain("This is an important note about configuration.");
    });

    test("GitHub task list HTML (input checkboxes stripped)", () => {
      const html = [
        '<ul class="contains-task-list">',
        '<li class="task-list-item"><input type="checkbox" checked disabled> Done</li>',
        '<li class="task-list-item"><input type="checkbox" disabled> Todo</li>',
        '</ul>',
      ].join("");
      const result = sanitize(html);
      expect(result).toContain("<ul>");
      expect(result).toContain("<li>");
      expect(result).not.toContain("<input");
      expect(result).not.toContain("class=");
      expect(result).toContain("Done");
      expect(result).toContain("Todo");
    });
  });

  describe("data attributes are stripped", () => {
    test("data-* attributes on allowed tags", () => {
      const html = '<p data-id="123" data-custom="val">text</p>';
      const result = sanitize(html);
      expect(result).not.toContain("data-id");
      expect(result).not.toContain("data-custom");
      expect(result).toBe("<p>text</p>");
    });

    test("data attributes on links", () => {
      const html = '<a href="https://example.com" data-track="click">link</a>';
      const result = sanitize(html);
      expect(result).not.toContain("data-track");
      expect(result).toContain('href="https://example.com"');
    });

    test("data attributes on images", () => {
      const html = '<img src="https://example.com/img.png" alt="pic" data-src="lazy.png" />';
      const result = sanitize(html);
      expect(result).not.toContain("data-src");
      expect(result).toContain('src="https://example.com/img.png"');
    });
  });

  describe("class attributes are stripped", () => {
    test("class on paragraph", () => {
      const html = '<p class="highlight important">text</p>';
      const result = sanitize(html);
      expect(result).not.toContain("class=");
      expect(result).toBe("<p>text</p>");
    });

    test("class on heading", () => {
      const html = '<h2 class="section-title" id="intro">Intro</h2>';
      const result = sanitize(html);
      expect(result).not.toContain("class=");
      expect(result).not.toContain("id=");
      expect(result).toBe("<h2>Intro</h2>");
    });

    test("class on list items", () => {
      const html = '<ul class="fancy-list"><li class="item">one</li></ul>';
      const result = sanitize(html);
      expect(result).not.toContain("class=");
      expect(result).toContain("<ul><li>one</li></ul>");
    });
  });

  describe("style attributes are stripped by default", () => {
    test("style on allowed tags", () => {
      const html = '<p style="color: red; font-size: 20px;">red text</p>';
      const result = sanitize(html);
      expect(result).not.toContain("style=");
      expect(result).toBe("<p>red text</p>");
    });

    test("style with background-image url", () => {
      const html = '<p style="background-image: url(https://evil.com/tracker.gif);">tracked</p>';
      const result = sanitize(html);
      expect(result).not.toContain("style=");
      expect(result).not.toContain("background-image");
      expect(result).toContain("tracked");
    });

    test("style on strong tag", () => {
      const html = '<strong style="color: blue;">bold blue</strong>';
      const result = sanitize(html);
      expect(result).not.toContain("style=");
      expect(result).toBe("<strong>bold blue</strong>");
    });

    test("style on link", () => {
      const html = '<a href="https://ok.com" style="display:none;">hidden</a>';
      const result = sanitize(html);
      expect(result).not.toContain("style=");
      expect(result).toContain('href="https://ok.com"');
      expect(result).toContain("hidden");
    });

    test("inline style with position: fixed overlay attack", () => {
      const html = '<p style="position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;">overlay</p>';
      const result = sanitize(html);
      expect(result).not.toContain("style=");
      expect(result).not.toContain("position:");
      expect(result).toBe("<p>overlay</p>");
    });
  });
});

// =============================================================================
// ROUND-TRIP TESTS
// =============================================================================
describe("round-trip tests", () => {
  describe("markdown -> HTML -> sanitize -> content verification", () => {
    test("full markdown document round-trip preserves all content", () => {
      const md = [
        "# Main Title",
        "",
        "An introductory paragraph with **bold** and *italic* text.",
        "",
        "## Features",
        "",
        "- Item one with `inline code`",
        "- Item two with a [link](https://example.com)",
        "- Item three",
        "",
        "### Code Example",
        "",
        "```",
        "const x = 42;",
        "```",
        "",
        "> A quote from someone wise.",
        "",
        "---",
        "",
        "Final paragraph.",
      ].join("\n");
      const result = renderMarkdown(md);
      // All content tokens present
      expect(result).toContain("Main Title");
      expect(result).toContain("introductory paragraph");
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>italic</em>");
      expect(result).toContain("Features");
      expect(result).toContain("<code>inline code</code>");
      expect(result).toContain("https://example.com");
      expect(result).toContain("Item three");
      expect(result).toContain("Code Example");
      expect(result).toContain("const x = 42;");
      expect(result).toContain("<blockquote>");
      expect(result).toContain("someone wise");
      expect(result).toContain("<hr");
      expect(result).toContain("Final paragraph");
    });

    test("markdown with all inline formats round-trips correctly", () => {
      const md = "**bold** *italic* `code` ~~struck~~ [link](https://x.com)";
      const result = renderMarkdown(md);
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("<em>italic</em>");
      expect(result).toContain("<code>code</code>");
      expect(result).toContain("struck"); // del tag stripped, text stays
      expect(result).toContain("https://x.com");
    });

    test("markdown with images round-trips correctly", () => {
      const md = "![A cat](https://example.com/cat.jpg)\n\nSome text after.";
      const result = renderMarkdown(md);
      expect(result).toContain('src="https://example.com/cat.jpg"');
      expect(result).toContain('alt="A cat"');
      expect(result).toContain("Some text after");
    });

    test("complex nested markdown round-trips without content loss", () => {
      const md = [
        "## Section",
        "",
        "> Quote with **bold** and a [link](https://x.com)",
        ">",
        "> Second paragraph in quote.",
        "",
        "1. First",
        "   - Sub A",
        "   - Sub B",
        "2. Second",
      ].join("\n");
      const result = renderMarkdown(md);
      expect(result).toContain("Section");
      expect(result).toContain("<blockquote>");
      expect(result).toContain("<strong>bold</strong>");
      expect(result).toContain("https://x.com");
      expect(result).toContain("Second paragraph in quote");
      expect(result).toContain("First");
      expect(result).toContain("Sub A");
      expect(result).toContain("Sub B");
      expect(result).toContain("Second");
    });
  });

  describe("plain text with special HTML characters", () => {
    test("angle brackets are escaped in sanitize output", () => {
      // Direct HTML input with unrecognized patterns
      const input = "5 < 10 and 20 > 15";
      const result = sanitize(input);
      // sanitize-html will handle bare < and > in text
      expect(result).not.toContain("<10");
      expect(result).toContain("5");
      expect(result).toContain("10");
    });

    test("ampersand in plain text is preserved", () => {
      const result = sanitize("Tom &amp; Jerry");
      expect(result).toContain("&amp;");
      expect(result).toContain("Tom");
      expect(result).toContain("Jerry");
    });

    test("quotes in text content are preserved", () => {
      const result = sanitize('<p>She said "hello" and \'goodbye\'</p>');
      expect(result).toContain("hello");
      expect(result).toContain("goodbye");
    });

    test("HTML entities pass through sanitize", () => {
      const input = "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>";
      const result = sanitize(input);
      // Should be preserved as literal entity text, not executed
      expect(result).toContain("&lt;script&gt;");
      expect(result).not.toContain("<script");
    });

    test("markdown with < > & renders safely", () => {
      const md = "Use `x < y` and `a & b` in expressions.";
      const result = renderMarkdown(md);
      expect(result).toContain("<code>");
      // Inside code, < and & should be escaped
      expect(result).toContain("x &lt; y");
      expect(result).toContain("a &amp; b");
    });
  });

  describe("markdown with emoji", () => {
    test("emoji in paragraph text renders correctly", () => {
      const md = "Hello world! Here is a thumbs up.";
      const result = renderMarkdown(md);
      expect(result).toContain("Hello world");
      expect(result).toContain("thumbs up");
    });

    test("unicode emoji characters pass through markdown rendering", () => {
      const md = "Status: ✅ Done and ❌ Failed";
      const result = renderMarkdown(md);
      expect(result).toContain("✅");
      expect(result).toContain("❌");
      expect(result).toContain("Done");
      expect(result).toContain("Failed");
    });

    test("emoji in headings", () => {
      const md = "## \u{1F680} Launch Notes";
      const result = renderMarkdown(md);
      expect(result).toContain("<h2");
      expect(result).toContain("\u{1F680}");
      expect(result).toContain("Launch Notes");
    });

    test("emoji in list items", () => {
      const md = "- \u{1F4E6} Package shipped\n- \u{1F527} Fixing bugs\n- ✨ New feature";
      const result = renderMarkdown(md);
      expect(result).toContain("<ul>");
      expect(result).toContain("\u{1F4E6}");
      expect(result).toContain("\u{1F527}");
      expect(result).toContain("✨");
    });

    test("emoji in code blocks are preserved as-is", () => {
      const md = "```\nconsole.log('\u{1F389}');\n```";
      const result = renderMarkdown(md);
      expect(result).toContain("<pre>");
      expect(result).toContain("\u{1F389}");
    });

    test("emoji in blockquotes", () => {
      const md = "> \u{1F4A1} Remember to always test your code.";
      const result = renderMarkdown(md);
      expect(result).toContain("<blockquote>");
      expect(result).toContain("\u{1F4A1}");
    });

    test("CJK characters in markdown", () => {
      const md = "## 测试标题\n\n这是一个测试。";
      const result = renderMarkdown(md);
      expect(result).toContain("<h2");
      expect(result).toContain("测试标题");
      expect(result).toContain("这是一个测试");
    });

    test("RTL text in markdown", () => {
      const md = "## مرحبا\n\nهذا اختبار.";
      const result = renderMarkdown(md);
      expect(result).toContain("<h2");
      expect(result).toContain("مرحبا");
    });
  });
});
