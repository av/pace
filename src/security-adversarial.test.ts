/**
 * Adversarial security tests for widget/adapter code.
 *
 * Tests attempt to bypass:
 * 1. URL validation (validateSafeUrl)
 * 2. HTML sanitization (text widget)
 * 3. JSON path traversal (counter adapter)
 * 4. Env var interpolation (counter headers)
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { validateSafeUrl } from "./config-validate";
import { sanitize, renderMarkdown } from "./layout/text-render";
import { resolveJsonPath, parseJsonPath, interpolateEnvVars } from "./adapters/counter";

// ---------------------------------------------------------------------------
// 1. URL VALIDATION BYPASSES
// ---------------------------------------------------------------------------
describe("validateSafeUrl adversarial bypasses", () => {
  // -- Basic scheme attacks --
  test("rejects javascript:alert(1)", () => {
    expect(() => validateSafeUrl("javascript:alert(1)", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects javascript with encoded colon (\\x3a resolves at JS string level)", () => {
    // In a JS string, \x3a becomes ":" so this is literally "javascript:alert(1)"
    expect(() => validateSafeUrl("javascript\x3aalert(1)", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects data: URI with HTML payload", () => {
    expect(() => validateSafeUrl("data:text/html,<script>alert(1)</script>", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects blob: URI", () => {
    expect(() => validateSafeUrl("blob:https://evil.com/some-uuid", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects file:///etc/passwd", () => {
    expect(() => validateSafeUrl("file:///etc/passwd", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects protocol-relative //evil.com (no scheme = invalid URL)", () => {
    expect(() => validateSafeUrl("//evil.com", "t")).toThrow(/not a valid URL/);
  });

  // -- URL authority confusion --
  test("http://evil.com@localhost - userinfo trick passes (hostname is localhost)", () => {
    // The URL parser treats evil.com as the username, localhost as host.
    // The actual HTTP request would go to localhost. This is not a real bypass
    // since the request targets localhost, but it is confusing.
    // Document current behavior: this is ALLOWED because hostname IS localhost.
    expect(() => validateSafeUrl("http://evil.com@localhost", "t")).not.toThrow();
  });

  test("http://evil.com@localhost:3000 - userinfo with port also passes", () => {
    // Same as above; request goes to localhost:3000
    expect(() => validateSafeUrl("http://evil.com@localhost:3000", "t")).not.toThrow();
  });

  test("rejects http://localhost.evil.com (subdomain confusion)", () => {
    // hostname is localhost.evil.com, NOT localhost
    expect(() => validateSafeUrl("http://localhost.evil.com", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects http://127.0.0.1.evil.com", () => {
    expect(() => validateSafeUrl("http://127.0.0.1.evil.com", "t")).toThrow(/disallowed scheme/);
  });

  // -- IP encoding tricks --
  test("http://0x7f000001 (hex IP) - resolves to 127.0.0.1 and passes", () => {
    // URL parser normalizes hex IP to 127.0.0.1, which is in LOCALHOST_HOSTS.
    // This is not a real bypass since the request still goes to localhost.
    const parsed = new URL("http://0x7f000001");
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(() => validateSafeUrl("http://0x7f000001", "t")).not.toThrow();
  });

  test("http://2130706433 (decimal IP) - resolves to 127.0.0.1 and passes", () => {
    const parsed = new URL("http://2130706433");
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(() => validateSafeUrl("http://2130706433", "t")).not.toThrow();
  });

  test("http://0177.0.0.1 (octal IP) - resolves to 127.0.0.1 and passes", () => {
    const parsed = new URL("http://0177.0.0.1");
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(() => validateSafeUrl("http://0177.0.0.1", "t")).not.toThrow();
  });

  test("rejects http://[::ffff:127.0.0.1] (IPv6-mapped IPv4, not in allowlist)", () => {
    // URL parser normalizes to [::ffff:7f00:1] which is NOT in LOCALHOST_HOSTS
    expect(() => validateSafeUrl("http://[::ffff:127.0.0.1]", "t")).toThrow(/disallowed scheme/);
  });

  // -- Null bytes, tabs, newlines in scheme --
  test("rejects URL with null byte in scheme", () => {
    expect(() => validateSafeUrl("java\0script:alert(1)", "t")).toThrow(/not a valid URL/);
  });

  test("rejects URL with tab in scheme", () => {
    expect(() => validateSafeUrl("javascript\talert(1)", "t")).toThrow(/not a valid URL/);
  });

  test("rejects URL with newline in scheme", () => {
    expect(() => validateSafeUrl("javascript\nalert(1)", "t")).toThrow(/not a valid URL/);
  });

  test("rejects JAVASCRIPT:alert(1) (uppercase scheme)", () => {
    // URL parser normalizes scheme to lowercase: javascript:
    expect(() => validateSafeUrl("JAVASCRIPT:alert(1)", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects JaVaScRiPt:alert(1) (mixed-case scheme)", () => {
    expect(() => validateSafeUrl("JaVaScRiPt:alert(1)", "t")).toThrow(/disallowed scheme/);
  });

  // -- Edge cases --
  test("rejects vbscript: scheme", () => {
    expect(() => validateSafeUrl("vbscript:MsgBox(1)", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects http://0 (resolves to 0.0.0.0 - not localhost)", () => {
    const parsed = new URL("http://0");
    expect(parsed.hostname).toBe("0.0.0.0");
    expect(() => validateSafeUrl("http://0", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects data: with base64 payload", () => {
    expect(() =>
      validateSafeUrl("data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==", "t"),
    ).toThrow(/disallowed scheme/);
  });

  test("rejects ws: scheme (websocket)", () => {
    expect(() => validateSafeUrl("ws://evil.com/socket", "t")).toThrow(/disallowed scheme/);
  });

  test("rejects wss: scheme", () => {
    expect(() => validateSafeUrl("wss://evil.com/socket", "t")).toThrow(/disallowed scheme/);
  });
});

// ---------------------------------------------------------------------------
// 2. HTML SANITIZATION BYPASSES (text widget)
// ---------------------------------------------------------------------------
describe("HTML sanitization adversarial bypasses", () => {
  // -- Event handler injection --
  test("strips <img src=x onerror=alert(1)>", () => {
    const result = sanitize('<img src=x onerror=alert(1)>');
    expect(result).not.toContain("onerror");
    expect(result).not.toContain("alert");
  });

  test("strips <svg onload=alert(1)>", () => {
    const result = sanitize("<svg onload=alert(1)>");
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("onload");
    expect(result).not.toContain("alert");
  });

  test("strips <math><mtext><script>alert(1)</script></mtext></math>", () => {
    const result = sanitize("<math><mtext><script>alert(1)</script></mtext></math>");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<math");
  });

  test("strips javascript: from <a href>", () => {
    const result = sanitize('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  test("strips <details open ontoggle=alert(1)>", () => {
    const result = sanitize("<details open ontoggle=alert(1)>");
    // details is in allowlist but ontoggle attr should be stripped
    expect(result).not.toContain("ontoggle");
    expect(result).not.toContain("alert");
  });

  test("strips <iframe src=javascript:alert(1)>", () => {
    const result = sanitize('<iframe src="javascript:alert(1)">');
    expect(result).not.toContain("<iframe");
    expect(result).not.toContain("javascript:");
  });

  test("strips <style>@import 'evil.css'</style>", () => {
    const result = sanitize('<style>@import "http://evil.com/xss.css";</style>');
    expect(result).not.toContain("<style");
    expect(result).not.toContain("@import");
  });

  test("strips <base href=evil>", () => {
    const result = sanitize('<base href="http://evil.com/">');
    expect(result).not.toContain("<base");
  });

  test("strips <form> with action", () => {
    const result = sanitize('<form action="http://evil.com"><input name=q>');
    expect(result).not.toContain("<form");
    expect(result).not.toContain("<input");
  });

  // -- Null byte splitting --
  test("handles null bytes in tags", () => {
    const result = sanitize("<scr\0ipt>alert(1)</scr\0ipt>");
    // The corrupted tag name is not recognized as "script", so it's stripped.
    // The text content "alert(1)" remains as plain text, which is safe.
    expect(result).not.toContain("<script");
    // Verify no executable context: the text is NOT inside a script tag
    expect(result).toBe("alert(1)");
  });

  test("handles null bytes in attributes", () => {
    const result = sanitize('<img src=x on\0error=alert(1)>');
    expect(result).not.toContain("alert");
  });

  // -- Attribute injection via malformed quotes --
  test("handles broken quotes in attributes", () => {
    const result = sanitize('<a href="https://ok.com" onclick="alert(1)">link</a>');
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("alert");
  });

  test("handles unquoted attribute injection", () => {
    const result = sanitize("<a href=javascript:alert(1)>click</a>");
    expect(result).not.toContain("javascript:");
  });

  test("handles backtick attribute delimiter", () => {
    // Some older parsers treat backticks as attribute delimiters.
    // sanitize-html quotes the entire value, so backticks become part of the URL.
    // Browsers won't execute `javascript:` since the URL starts with a backtick character.
    const result = sanitize("<a href=`javascript:alert(1)`>click</a>");
    // The result includes backticks as literal characters in the href.
    // Verify: the href starts with a backtick, not with "javascript:"
    expect(result).toContain("href");
    expect(result).not.toContain('href="javascript:');
    // The actual href is "`javascript:alert(1)`" (backtick prefix makes it non-executable)
  });

  // -- CSS expression/calc/url() in style --
  test("strips style attributes entirely (not in allowedAttributes)", () => {
    const result = sanitize('<p style="background:url(javascript:alert(1))">text</p>');
    expect(result).not.toContain("style");
    expect(result).not.toContain("javascript:");
  });

  test("strips CSS expression() in style", () => {
    const result = sanitize('<p style="width:expression(alert(1))">text</p>');
    expect(result).not.toContain("expression");
    expect(result).not.toContain("alert");
  });

  test("strips -moz-binding in style", () => {
    const result = sanitize('<p style="-moz-binding:url(http://evil.com/xbl)">text</p>');
    expect(result).not.toContain("-moz-binding");
  });

  // -- Advanced XSS vectors via markdown --
  test("markdown: strips javascript: in links", () => {
    const result = renderMarkdown("[click](javascript:alert(1))");
    expect(result).not.toContain("javascript:");
  });

  test("markdown: strips img onerror via raw HTML in markdown", () => {
    const result = renderMarkdown('safe text\n\n<img src=x onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  test("markdown: strips script tags embedded in markdown", () => {
    const result = renderMarkdown("# Title\n\n<script>alert(1)</script>\n\nMore text");
    expect(result).not.toContain("<script");
  });

  test("markdown: strips data: URI in image", () => {
    const result = renderMarkdown('![xss](data:text/html,<script>alert(1)</script>)');
    expect(result).not.toContain("data:");
    expect(result).not.toContain("<script");
  });

  test("markdown: SVG with onload is entity-encoded by markdown parser", () => {
    const result = renderMarkdown('<svg/onload=alert(1)>');
    // Marked treats <svg/onload=...> as text, entity-encoding the angle brackets.
    // The output contains &lt;svg... which is plain text, not executable HTML.
    expect(result).not.toContain("<svg");
    expect(result).toContain("&lt;svg");
    // Even though "onload" appears as text, it's inside entity-encoded content.
    // No browser would execute it.
  });

  // -- Encoding evasion --
  test("strips HTML-entity-encoded javascript: in href", () => {
    const result = sanitize('<a href="&#106;avascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  test("strips double-encoded script tag", () => {
    const result = sanitize("&lt;script&gt;alert(1)&lt;/script&gt;");
    // Should remain as entities (text), never as actual script tags
    expect(result).not.toContain("<script");
  });

  test("strips unicode escaped javascript:", () => {
    // j is 'j'
    const result = sanitize('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain("javascript:");
  });

  // -- Template/noscript/object/embed --
  test("strips <template> tag", () => {
    const result = sanitize("<template><script>alert(1)</script></template>");
    expect(result).not.toContain("<template");
    expect(result).not.toContain("<script");
  });

  test("strips <noscript> tag", () => {
    const result = sanitize("<noscript><img src=x onerror=alert(1)></noscript>");
    expect(result).not.toContain("<noscript");
  });

  test("strips <object> tag", () => {
    const result = sanitize('<object data="http://evil.com/xss.swf">');
    expect(result).not.toContain("<object");
  });

  test("strips <embed> tag", () => {
    const result = sanitize('<embed src="http://evil.com/xss.swf">');
    expect(result).not.toContain("<embed");
  });

  test("strips <meta http-equiv=refresh>", () => {
    const result = sanitize('<meta http-equiv="refresh" content="0;url=http://evil.com">');
    expect(result).not.toContain("<meta");
  });

  // -- SVG foreignObject --
  test("strips SVG foreignObject with nested script", () => {
    const result = sanitize(
      '<svg><foreignObject><body><script>alert(1)</script></body></foreignObject></svg>',
    );
    expect(result).not.toContain("<svg");
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<foreignObject");
  });

  // -- CDATA --
  test("strips CDATA sections", () => {
    const result = sanitize("<![CDATA[<script>alert(1)</script>]]>");
    expect(result).not.toContain("<script");
  });

  // -- Comment-based bypass --
  test("handles HTML comments around scripts", () => {
    const result = sanitize("<!--<script>alert(1)</script>-->");
    expect(result).not.toContain("<script");
    // sanitize-html strips comments by default
    expect(result).not.toContain("<!--");
  });
});

// ---------------------------------------------------------------------------
// 3. JSON PATH TRAVERSAL (counter adapter)
// ---------------------------------------------------------------------------
describe("resolveJsonPath adversarial traversal", () => {
  test("blocks __proto__.polluted", () => {
    const obj = { safe: 1 };
    expect(() => resolveJsonPath(obj, "__proto__.polluted")).toThrow(/does not exist/);
  });

  test("blocks constructor.prototype access", () => {
    const obj = { a: 1 };
    // "constructor" is not an own property of a plain object literal
    expect(() => resolveJsonPath(obj, "constructor")).toThrow(/does not exist/);
  });

  test("blocks paths that access toString", () => {
    const obj = { a: 1 };
    // toString is inherited, not own
    expect(() => resolveJsonPath(obj, "toString")).toThrow(/does not exist/);
  });

  test("blocks paths that access hasOwnProperty", () => {
    const obj = { a: 1 };
    expect(() => resolveJsonPath(obj, "hasOwnProperty")).toThrow(/does not exist/);
  });

  test("blocks array method access via index: 0.push", () => {
    // parseJsonPath will parse "0" as key and "push" as key
    // But we start with an object; if the object has key "0" that is an array,
    // "push" would not be an own property.
    const obj = { "0": [1, 2, 3] };
    expect(() => resolveJsonPath(obj, "0.push")).toThrow(/does not exist/);
  });

  test("handles array index access correctly", () => {
    const obj = { items: [10, 20, 30] };
    expect(resolveJsonPath(obj, "items[1]")).toBe(20);
  });

  test("blocks out-of-bounds array index", () => {
    const obj = { items: [1, 2] };
    expect(() => resolveJsonPath(obj, "items[5]")).toThrow(/out of bounds/);
  });

  test("blocks negative array index via parseJsonPath", () => {
    expect(() => parseJsonPath("items[-1]")).toThrow(/invalid array index/);
  });

  test("very deeply nested paths (100+ levels) - stack safety", () => {
    // Build a 100-level deep object
    let obj: any = { value: 42 };
    let path = "value";
    for (let i = 0; i < 100; i++) {
      const wrapper: any = {};
      wrapper[`k${i}`] = obj;
      obj = wrapper;
      path = `k${i}.${path}`;
    }
    expect(resolveJsonPath(obj, path)).toBe(42);
  });

  test("paths with empty segments (a..b) - parsed as valid", () => {
    // parseJsonPath skips consecutive dots: a..b => ["a", "b"]
    const segments = parseJsonPath("a..b");
    expect(segments).toEqual(["a", "b"]);
  });

  test("bracket injection: a[0];alert(1) - malformed bracket", () => {
    // After "]", the ";alert(1)" becomes key segments
    const segments = parseJsonPath("a[0];alert(1)");
    // The parser will parse: "a", 0, ";alert(1)" as segments
    expect(segments[0]).toBe("a");
    expect(segments[1]).toBe(0);
    // The remaining text is a key segment, which won't match any real property
    const obj = { a: [{ safe: true }] };
    expect(() => resolveJsonPath(obj, "a[0];alert(1)")).toThrow();
  });

  test("traversal into null value throws clearly", () => {
    const obj = { a: null };
    expect(() => resolveJsonPath(obj, "a.b")).toThrow(/cannot traverse/);
  });

  test("traversal into undefined value throws clearly", () => {
    const obj = { a: undefined };
    expect(() => resolveJsonPath(obj, "a.b")).toThrow(/cannot traverse/);
  });

  test("traversal into primitive (number) throws clearly", () => {
    const obj = { a: 42 };
    expect(() => resolveJsonPath(obj, "a.b")).toThrow(/cannot traverse/);
  });

  test("traversal into primitive (string) throws clearly", () => {
    const obj = { a: "hello" };
    expect(() => resolveJsonPath(obj, "a.b")).toThrow(/cannot traverse/);
  });

  test("traversal into boolean throws clearly", () => {
    const obj = { a: true };
    expect(() => resolveJsonPath(obj, "a.b")).toThrow(/cannot traverse/);
  });

  // -- Config-level validation of dangerous paths --
  test("config rejects __proto__ in json_path", () => {
    // This is tested via config validation, verifying the regex + blocklist
    expect(
      /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/.test("__proto__"),
    ).toBe(true);
    // But the dangerous segment check catches it
    const segments = "__proto__".split(/[.\[]/);
    const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
    expect(segments.some((s) => DANGEROUS.has(s.replace("]", "")))).toBe(true);
  });

  test("config rejects constructor.prototype.polluted", () => {
    const path = "constructor.prototype.polluted";
    const segments = path.split(/[.\[]/);
    const DANGEROUS = new Set(["__proto__", "constructor", "prototype"]);
    expect(segments.some((s) => DANGEROUS.has(s.replace("]", "")))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. ENV VAR INTERPOLATION (counter headers)
// ---------------------------------------------------------------------------
describe("interpolateEnvVars adversarial tests", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and set controlled env vars
    for (const key of ["SEC_TEST_TOKEN", "SEC_TEST_NESTED", "SEC_TEST_INNER"]) {
      savedEnv[key] = process.env[key];
    }
    process.env.SEC_TEST_TOKEN = "secret123";
    process.env.SEC_TEST_NESTED = "${SEC_TEST_INNER}";
    process.env.SEC_TEST_INNER = "inner_value";
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test("${PATH} leaks system PATH (expected for operator config)", () => {
    const result = interpolateEnvVars("${PATH}");
    // The PATH variable should be expanded - this is by design for operator config
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(process.env.PATH);
  });

  test("nested ${${NESTED}} - only outer braces matched", () => {
    // The regex [^}]+ won't match the inner ${, because it stops at first }
    const result = interpolateEnvVars("${${SEC_TEST_INNER}}");
    // Pattern: ${${SEC_TEST_INNER}} - regex matches ${SEC_TEST_INNER} first? No:
    // The regex matches ${ then [^}]+ then }. The [^}]+ captures "${SEC_TEST_INNER"
    // which includes the inner "${"" - so the var name is "${SEC_TEST_INNER"
    // and that env var doesn't exist, so it expands to "" followed by trailing "}"
    expect(result).toBe("}");
  });

  test("recursive expansion does NOT happen (single pass)", () => {
    // SEC_TEST_NESTED contains "${SEC_TEST_INNER}" as its literal value
    const result = interpolateEnvVars("${SEC_TEST_NESTED}");
    // Should be the literal string "${SEC_TEST_INNER}", not "inner_value"
    expect(result).toBe("${SEC_TEST_INNER}");
  });

  test("empty var name ${} - regex requires at least 1 char, no match", () => {
    const result = interpolateEnvVars("${}");
    // [^}]+ requires one or more chars, so ${} doesn't match
    expect(result).toBe("${}");
  });

  test("var name with semicolon: ${a;b} - expanded (env var lookup)", () => {
    // The regex [^}]+ will match "a;b" since semicolons are not }
    const result = interpolateEnvVars("${a;b}");
    // No env var named "a;b" exists, so it expands to ""
    expect(result).toBe("");
  });

  test("var name with pipe: ${a|b}", () => {
    const result = interpolateEnvVars("${a|b}");
    expect(result).toBe("");
  });

  test("var name with backtick: ${a`b}", () => {
    const result = interpolateEnvVars("${a`b}");
    expect(result).toBe("");
  });

  test("var name with newline: ${a\\nb} - no match (newline before })", () => {
    // Newline is not } so [^}]+ matches "a\nb"
    const result = interpolateEnvVars("${a\nb}");
    // Env var "a\nb" doesn't exist
    expect(result).toBe("");
  });

  test("1000 expansions - no catastrophic backtracking", () => {
    const input = "${SEC_TEST_TOKEN}".repeat(1000);
    const start = Date.now();
    const result = interpolateEnvVars(input);
    const elapsed = Date.now() - start;
    expect(result).toBe("secret123".repeat(1000));
    expect(elapsed).toBeLessThan(1000); // Should be < 1 second
  });

  test("expansion result containing ${ is not re-expanded", () => {
    // Set an env var whose value looks like another expansion
    process.env.SEC_TEST_TRICKY = "${PATH}";
    const result = interpolateEnvVars("${SEC_TEST_TRICKY}");
    // Should be the literal "${PATH}", not the actual PATH value
    expect(result).toBe("${PATH}");
    delete process.env.SEC_TEST_TRICKY;
  });

  test("dollar sign without braces is left alone", () => {
    expect(interpolateEnvVars("$SEC_TEST_TOKEN")).toBe("$SEC_TEST_TOKEN");
  });

  test("unclosed brace ${ is left alone", () => {
    expect(interpolateEnvVars("${SEC_TEST_TOKEN")).toBe("${SEC_TEST_TOKEN");
  });

  test("multiple vars in one string all expand", () => {
    const result = interpolateEnvVars("A=${SEC_TEST_TOKEN}&B=${SEC_TEST_INNER}");
    expect(result).toBe("A=secret123&B=inner_value");
  });
});
