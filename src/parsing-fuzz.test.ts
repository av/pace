/**
 * Seeded property/fuzz tests for the parsing surfaces hardened during this
 * run: OPML import, RSS/Atom feed detection, RSS-output XML escaping,
 * engagement-count parsing, and CSS-length validation.
 *
 * Determinism: every generator draws from a fixed-seed mulberry32 PRNG, so a
 * failure reproduces exactly on re-run - there is no flaky randomness. Each
 * property test documents the invariant it checks; failures throw with the
 * offending generated input serialized so the case can be replayed by hand.
 */
import { describe, test, spyOn } from "bun:test";
import { XMLValidator } from "fast-xml-parser";
import { parseOpml, generateImportedConfig } from "./cli-import";
import {
  feedXmlParser,
  hasRssAtomFeedRoot,
  extractRssAtomItems,
} from "./adapters/atom";
import { escapeXml, renderRssItem } from "./server/api-panels-rss";
import { extractScore, extractEngagementScore, formatStars } from "./adapters/engagement";
import { validateParsedConfig } from "./config-validate";
import { DEFAULT_LAYOUT } from "./config/domain";
import { makeContentItemRow } from "./test/content-items";

// ---------------------------------------------------------------------------
// Deterministic PRNG + generators
// ---------------------------------------------------------------------------

type Rng = () => number;

/** mulberry32: tiny, well-distributed, fully determined by its 32-bit seed. */
function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function int(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[int(rng, 0, arr.length - 1)];
}

/**
 * Character pool biased toward XML/YAML/regex trouble: metacharacters,
 * XML-illegal C0 controls and non-characters, legal controls (tab/LF/CR),
 * multi-byte and astral unicode, quoting/injection punctuation.
 */
const HOSTILE_CHARS = [
  "&", "<", ">", '"', "'", "]", "/", "\\", ";", ":", "=", "`", "#", "%", "?",
  "(", ")", "{", "}", ",", ".", "-", "_", " ", "\n", "\t", "\r",
  "\u0000", "\u0001", "\u0008", "\u000B", "\u000C", "\u001B", "\u007F",
  "￾", "￿",
  "é", "ß", "漢", "∑", "\u{1F680}", "\u{1D54F}",
  "a", "B", "z", "0", "7", "9",
] as const;

function hostileString(rng: Rng, maxLen = 24): string {
  const len = int(rng, 0, maxLen);
  let out = "";
  for (let i = 0; i < len; i++) out += pick(rng, HOSTILE_CHARS);
  return out;
}

/** Random garbage body: plain text, JSON, HTML page, or wrong-root XML. */
function garbageBody(rng: Rng): string {
  switch (int(rng, 0, 3)) {
    case 0:
      return hostileString(rng, 60);
    case 1:
      return JSON.stringify({ [hostileString(rng, 6) || "k"]: hostileString(rng, 12), n: int(rng, 0, 9999) });
    case 2:
      return `<!doctype html><html><head><title>${escapeXml(hostileString(rng, 10))}</title></head><body><p>${escapeXml(hostileString(rng, 30))}</p></body></html>`;
    default: {
      // Well-formed XML whose root is anything but rss/feed/opml.
      const roots = ["html", "channel", "items", "data", "response", "error", "result"] as const;
      const root = pick(rng, roots);
      return `<${root}><child>${escapeXml(hostileString(rng, 20))}</child></${root}>`;
    }
  }
}

/** Mirrors the XML-illegal character class escapeXml documents and strips. */
const XML_ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]/g;

/**
 * What a conforming XML parser recovers from escapeXml-embedded text:
 * XML-illegal chars are stripped by escapeXml, bare CR / CRLF are normalized
 * to LF by every spec-compliant parser (XML 1.0 §2.11 end-of-line handling),
 * and fast-xml-parser trims leading/trailing whitespace from text nodes.
 */
function expectedXmlRoundTrip(s: string): string {
  return s.replace(XML_ILLEGAL, "").replace(/\r\n?/g, "\n").trim();
}

function fail(label: string, i: number, input: unknown, detail: string): never {
  throw new Error(`${label} (case ${i}, input ${JSON.stringify(input)}): ${detail}`);
}

// ---------------------------------------------------------------------------
// XML escaping (api-panels-rss)
// ---------------------------------------------------------------------------

describe("fuzz: escapeXml round-trip", () => {
  test("invariant: for ANY string, escapeXml output embedded in an element yields well-formed XML that parses back to the input minus XML-illegal chars (modulo parser edge trimming)", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 300; i++) {
      const s = hostileString(rng, 32);
      const doc = `<rss version="2.0"><channel><title>t</title><item><title>${escapeXml(s)}</title></item></channel></rss>`;
      const valid = XMLValidator.validate(doc);
      if (valid !== true) fail("escapeXml produced invalid XML", i, s, JSON.stringify(valid));
      const parsed = feedXmlParser.parse(doc) as {
        rss?: { channel?: { item?: { title?: unknown } } };
      };
      const got = parsed.rss?.channel?.item?.title ?? "";
      const expected = expectedXmlRoundTrip(s);
      if (got !== expected) {
        fail("escapeXml round-trip mismatch", i, s, `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
      }
    }
  });

  test("invariant: renderRssItem stays well-formed XML for hostile title/url/id/source/summary and round-trips the title", () => {
    const rng = mulberry32(0xbeef01);
    for (let i = 0; i < 120; i++) {
      const title = hostileString(rng, 24);
      const row = makeContentItemRow({
        id: `fuzz-${i}`,
        title,
        url: `https://example.com/${encodeURIComponent(hostileString(rng, 8))}`,
        source: hostileString(rng, 10) || "src",
        summary: rng() < 0.5 ? hostileString(rng, 40) : null,
      });
      const doc = `<channel>${renderRssItem(row)}</channel>`;
      const valid = XMLValidator.validate(doc);
      if (valid !== true) fail("renderRssItem produced invalid XML", i, row.title, JSON.stringify(valid));
      const parsed = feedXmlParser.parse(doc) as { channel?: { item?: { title?: unknown } } };
      const got = parsed.channel?.item?.title ?? "";
      const expected = expectedXmlRoundTrip(title);
      if (got !== expected) {
        fail("renderRssItem title mismatch", i, title, `got ${JSON.stringify(got)}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// RSS/Atom feed detection (adapters/atom, garbage guard from fetch.ts)
// ---------------------------------------------------------------------------

describe("fuzz: RSS/Atom feed parsing", () => {
  test("invariant: garbage bodies never look like a feed - parse either throws or yields no rss/feed root, and item extraction never throws", () => {
    const rng = mulberry32(0xfeed99);
    for (let i = 0; i < 200; i++) {
      const body = garbageBody(rng);
      // The generator cannot emit an accidental feed root, but keep the
      // filter explicit so alphabet changes can't silently weaken the test.
      if (/<\s*(rss|feed)[\s>]/i.test(body)) continue;
      let parsed: unknown;
      try {
        parsed = feedXmlParser.parse(body);
      } catch (err) {
        if (!(err instanceof Error)) fail("parser threw a non-Error", i, body, String(err));
        continue; // throwing is a valid outcome: fetch surfaces it as a failure
      }
      if (hasRssAtomFeedRoot(parsed)) {
        fail("garbage detected as feed", i, body, "hasRssAtomFeedRoot returned true");
      }
      const items = extractRssAtomItems(parsed as Record<string, never>);
      if (!Array.isArray(items)) fail("extractRssAtomItems non-array", i, body, typeof items);
    }
  });

  test("invariant: generated RSS and Atom feeds with hostile titles always detect a root and yield exactly N items", () => {
    const rng = mulberry32(0xfeed42);
    for (let i = 0; i < 80; i++) {
      const n = int(rng, 1, 6);
      const titles = Array.from({ length: n }, () => escapeXml(hostileString(rng, 16)));
      const atom = rng() < 0.5;
      const doc = atom
        ? `<feed xmlns="http://www.w3.org/2005/Atom"><title>f</title>${titles
            .map((t) => `<entry><title>${t}</title><id>x</id></entry>`)
            .join("")}</feed>`
        : `<rss version="2.0"><channel><title>f</title>${titles
            .map((t) => `<item><title>${t}</title><link>https://example.com/</link></item>`)
            .join("")}</channel></rss>`;
      const parsed = feedXmlParser.parse(doc);
      if (!hasRssAtomFeedRoot(parsed)) fail("valid feed not detected", i, doc, "root missed");
      const items = extractRssAtomItems(parsed as Record<string, never>);
      if (items.length !== n) fail("item count mismatch", i, doc, `got ${items.length}, expected ${n}`);
    }
  });
});

// ---------------------------------------------------------------------------
// OPML parsing (cli-import)
// ---------------------------------------------------------------------------

type GeneratedOpml = {
  xml: string;
  urls: string[];
  duplicates: number;
  skipped: number;
};

/**
 * Build a random OPML document with nested folders (depth <= 3), hostile
 * escaped titles, deliberate duplicate feeds, and broken (xmlUrl-less) leaves,
 * tracking the exact counts parseOpml must report.
 */
function genOpml(rng: Rng): GeneratedOpml {
  let urlCounter = 0;
  const urls: string[] = [];
  let duplicates = 0;
  let skipped = 0;

  const feedOutline = (url: string): string =>
    `<outline type="rss" text="${escapeXml(hostileString(rng, 12))}" xmlUrl="${url}"/>`;

  const newFeed = (): string => {
    const url = `https://example.com/feed-${urlCounter++}.xml`;
    urls.push(url);
    return feedOutline(url);
  };

  function genOutlines(depth: number, budget: { n: number }): string {
    const parts: string[] = [];
    const count = int(rng, 1, 3);
    for (let i = 0; i < count && budget.n > 0; i++) {
      budget.n--;
      const kind = rng();
      if (kind < 0.5 || depth >= 3) {
        // Feed leaf; sometimes a duplicate of an already-emitted url
        // (document order guarantees the original precedes the dupe).
        if (urls.length > 0 && rng() < 0.25) {
          duplicates++;
          parts.push(feedOutline(pick(rng, urls)));
        } else {
          parts.push(newFeed());
        }
      } else if (kind < 0.65) {
        // Broken leaf: no xmlUrl, no children.
        skipped++;
        parts.push(`<outline text="${escapeXml(hostileString(rng, 10))}"/>`);
      } else {
        const inner = genOutlines(depth + 1, budget);
        if (inner === "") {
          // Childless folder degrades to a broken leaf in parseOpml's eyes.
          skipped++;
        }
        parts.push(`<outline title="${escapeXml(hostileString(rng, 12))}">${inner}</outline>`);
      }
    }
    return parts.join("");
  }

  const body = genOutlines(0, { n: int(rng, 3, 14) }) + newFeed();
  const xml = `<?xml version="1.0" encoding="UTF-8"?><opml version="2.0"><head><title>${escapeXml(
    hostileString(rng, 10),
  )}</title></head><body>${body}</body></opml>`;
  return { xml, urls, duplicates, skipped };
}

describe("fuzz: OPML import", () => {
  test("invariant: generated OPML always parses to exactly the unique inserted urls with exact duplicate/skip counts and non-empty titles", () => {
    const rng = mulberry32(0x0b0e11);
    for (let i = 0; i < 60; i++) {
      const gen = genOpml(rng);
      const result = parseOpml(gen.xml, "fuzz.opml");
      const parsedUrls = result.groups.flatMap((g) => g.feeds.map((f) => f.xmlUrl));
      const sorted = [...parsedUrls].sort();
      const expected = [...gen.urls].sort();
      if (JSON.stringify(sorted) !== JSON.stringify(expected)) {
        fail("url set mismatch", i, gen.xml, `got ${JSON.stringify(sorted)}, expected ${JSON.stringify(expected)}`);
      }
      if (result.feedCount !== gen.urls.length) {
        fail("feedCount mismatch", i, gen.xml, `got ${result.feedCount}, expected ${gen.urls.length}`);
      }
      if (result.duplicateCount !== gen.duplicates) {
        fail("duplicateCount mismatch", i, gen.xml, `got ${result.duplicateCount}, expected ${gen.duplicates}`);
      }
      if (result.skippedNoXmlUrl !== gen.skipped) {
        fail("skippedNoXmlUrl mismatch", i, gen.xml, `got ${result.skippedNoXmlUrl}, expected ${gen.skipped}`);
      }
      for (const group of result.groups) {
        if (typeof group.title !== "string" || group.title === "") {
          fail("empty group title", i, gen.xml, JSON.stringify(group));
        }
        for (const feed of group.feeds) {
          if (typeof feed.title !== "string" || feed.title === "") {
            fail("empty feed title", i, gen.xml, JSON.stringify(feed));
          }
        }
      }
    }
  });

  test("invariant: generateImportedConfig never throws for any parsed hostile OPML and mentions every feed url (output self-validates against the real config schema)", () => {
    const rng = mulberry32(0x0b0e12);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 40; i++) {
        const gen = genOpml(rng);
        const result = parseOpml(gen.xml, "fuzz.opml");
        const yaml = generateImportedConfig(result, "fuzz.opml");
        for (const url of gen.urls) {
          if (!yaml.includes(url)) fail("generated config lost a feed url", i, url, yaml);
        }
      }
    } finally {
      warnSpy.mockRestore();
    }
  });

  test("invariant: hostile non-OPML input either throws a diagnosable `import:` Error or parses to a well-formed result - never a silent zero-feed success or a non-Error throw", () => {
    const rng = mulberry32(0x0b0e13);
    for (let i = 0; i < 200; i++) {
      const body = garbageBody(rng);
      if (/<\s*opml[\s>]/i.test(body)) continue;
      try {
        const result = parseOpml(body, "fuzz.opml");
        // Reachable only if garbage happened to be valid OPML with feeds -
        // the generator can't produce that, so a return here means the
        // zero-feed guard was bypassed.
        fail("garbage accepted as OPML", i, body, JSON.stringify(result));
      } catch (err) {
        if (!(err instanceof Error)) fail("non-Error throw", i, body, String(err));
        if (err.message.includes("garbage accepted as OPML")) throw err;
        if (!err.message.startsWith("import:")) {
          fail("undiagnosable error", i, body, err.message);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Engagement-count parsing (adapters/engagement)
// ---------------------------------------------------------------------------

describe("fuzz: engagement-count parsing", () => {
  test("invariant: en-US grouped counts round-trip exactly through every scored metric term at its documented weight", () => {
    const rng = mulberry32(0xe46a6e);
    // [term variants, weight] mirroring COUNT_METRIC_SPECS + primaries.
    const metrics: Array<[string[], number]> = [
      [["point", "points"], 1],
      [["upvote", "upvotes"], 1],
      [["boost", "boosts"], 1],
      [["favourite", "favourites", "favorite", "favorites"], 1],
      [["star", "stars"], 1],
      [["like", "likes"], 1],
      [["comment", "comments"], 0.5],
    ];
    const SAFE_PREFIX = ["", "Repo update ", "by someone — ", "漢字 "];
    for (let i = 0; i < 250; i++) {
      const n = int(rng, 0, 2_147_483_647);
      const [variants, weight] = pick(rng, metrics);
      const body = `${pick(rng, SAFE_PREFIX)}${n.toLocaleString("en-US")} ${pick(rng, variants)}`;
      const got = extractEngagementScore(body);
      const expected = Math.floor(n * weight);
      if (got !== expected) fail("engagement score mismatch", i, body, `got ${got}, expected ${expected}`);
    }
    // formatStars is the emitting side of the same contract (iteration 1).
    for (let i = 0; i < 50; i++) {
      const n = int(rng, 0, 99_999_999);
      const body = formatStars(n);
      const got = extractEngagementScore(body);
      if (got !== n) fail("formatStars round-trip mismatch", i, body, `got ${got}, expected ${n}`);
    }
  });

  test("invariant: malformed thousand-grouping never concatenates across the comma - only the digits adjacent to the term are parsed", () => {
    const rng = mulberry32(0xe46a6f);
    for (let i = 0; i < 200; i++) {
      const a = int(rng, 1, 999);
      // Group lengths 1, 2, 4, 5 are all invalid as a grouped tail (only
      // exactly 3 digits may follow a comma), so "A,B points" must parse as
      // parseInt(B), never A*10^len(B)+B.
      const len = pick(rng, [1, 2, 4, 5] as const);
      const b = String(int(rng, 10 ** (len - 1), 10 ** len - 1));
      const body = `${a},${b} points`;
      const got = extractScore(body);
      const expected = parseInt(b, 10);
      if (got !== expected) fail("malformed grouping mis-parse", i, body, `got ${got}, expected ${expected}`);
    }
  });

  test("invariant: extractors are total over hostile input - always a finite number >= 0, never NaN or a throw", () => {
    const rng = mulberry32(0xe46a70);
    for (let i = 0; i < 300; i++) {
      const body = hostileString(rng, 60);
      for (const [label, fn] of [
        ["extractScore", extractScore],
        ["extractEngagementScore", extractEngagementScore],
      ] as const) {
        const got = fn(body);
        if (!Number.isFinite(got) || got < 0) {
          fail(`${label} not finite/non-negative`, i, body, String(got));
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CSS-length validation (config-validate, iteration 8)
// ---------------------------------------------------------------------------

describe("fuzz: CSS-length validation", () => {
  /** The documented grammar: unsigned integer + one of the five units. */
  const CSS_LENGTH = /^\d+(px|rem|em|vh|%)$/;

  function accepts(node: Record<string, unknown>): boolean {
    try {
      validateParsedConfig(
        { layout: { direction: "row", children: [node] } },
        DEFAULT_LAYOUT,
      );
      return true;
    } catch {
      return false;
    }
  }

  /** Mix of hostile strings and near-miss length-shaped strings. */
  function cssCandidate(rng: Rng): string {
    if (rng() < 0.4) return hostileString(rng, 16);
    const sign = rng() < 0.2 ? "-" : "";
    const digits = String(int(rng, 0, 99999));
    const frac = rng() < 0.2 ? `.${int(rng, 0, 99)}` : "";
    const unit = pick(rng, ["px", "rem", "em", "vh", "%", "pt", "vw", "vmin", "", "px;", " px", "px ", "PX"] as const);
    const junk = rng() < 0.15 ? pick(rng, [";background:url(//evil.example)", "'", '"', "}"] as const) : "";
    return `${sign}${digits}${frac}${unit}${junk}`;
  }

  test("invariant: image max_height and iframe height accept EXACTLY the strict CSS-length grammar - any deviation (style-injection chars, signs, decimals, unknown units, whitespace, case) is rejected", () => {
    const rng = mulberry32(0xc55c55);
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 250; i++) {
        const value = cssCandidate(rng);
        const expected = CSS_LENGTH.test(value);
        const image = accepts({ image: "https://example.com/x.png", max_height: value });
        if (image !== expected) {
          fail("image max_height validator disagrees with grammar", i, value, `accepted=${image}, expected=${expected}`);
        }
        const iframe = accepts({ iframe: "https://example.com", height: value });
        if (iframe !== expected) {
          fail("iframe height validator disagrees with grammar", i, value, `accepted=${iframe}, expected=${expected}`);
        }
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
