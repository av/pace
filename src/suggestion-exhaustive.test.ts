/**
 * Exhaustive regression tests for every "did you mean?" suggestion entry
 * in config-validate.ts. If a key in any suggestion map is renamed or
 * removed, the corresponding test here will fail.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "./config";

let tmpDir: string;
let cfgPath: string;
let origEnv: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pace-suggest-"));
  cfgPath = join(tmpDir, "config.yaml");
  origEnv = process.env.PACE_CONFIG;
});

afterEach(() => {
  if (origEnv === undefined) {
    delete process.env.PACE_CONFIG;
  } else {
    process.env.PACE_CONFIG = origEnv;
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

function setConfig(yaml: string): void {
  writeFileSync(cfgPath, yaml);
  process.env.PACE_CONFIG = cfgPath;
}

// ---------------------------------------------------------------------------
// LAYOUT_KEY_SUGGESTIONS: 13 entries
// These are wrong keys at the layout-node level that should suggest the
// correct discriminator key.
// ---------------------------------------------------------------------------

describe("LAYOUT_KEY_SUGGESTIONS - exhaustive", () => {
  const layoutSuggestions: Record<string, string> = {
    img: "image",
    src: "image",
    picture: "image",
    photo: "image",
    content: "text",
    body: "text",
    markdown: "text",
    html: "text",
    url: "iframe",
    embed: "iframe",
    frame: "iframe",
    link: "image",
    ratio: "iframe",
    aspect_ratio: "iframe",
  };

  for (const [wrong, correct] of Object.entries(layoutSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      // Use a value that the correct discriminator would accept for its type.
      // The suggestion fires before any field-level validation, so the value
      // does not matter much - we just need it to be valid YAML.
      const yaml = `
layout:
  direction: row
  children:
    - ${wrong}: "https://example.com/test"
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(`has unknown key "${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// IMAGE_WIDGET_KEY_SUGGESTIONS: 10 entries
// Wrong field names inside an image widget node.
// ---------------------------------------------------------------------------

describe("IMAGE_WIDGET_KEY_SUGGESTIONS - exhaustive", () => {
  const imageSuggestions: Record<string, string> = {
    "object-fit": "object_fit",
    objectfit: "object_fit",
    objectFit: "object_fit",
    fit: "object_fit",
    "max-height": "max_height",
    maxHeight: "max_height",
    height: "max_height",
    src: "image",
    url: "image",
    href: "link",
  };

  for (const [wrong, correct] of Object.entries(imageSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      // We need the image discriminator key present, plus the wrong key.
      // YAML quoting handles keys with hyphens, camelCase, etc.
      const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      "${wrong}": some-value
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(
          `${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid image widget field; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// TEXT_WIDGET_KEY_SUGGESTIONS: 5 entries
// Wrong field names inside a text widget node.
// ---------------------------------------------------------------------------

describe("TEXT_WIDGET_KEY_SUGGESTIONS - exhaustive", () => {
  const textSuggestions: Record<string, string> = {
    content: "text",
    body: "text",
    value: "text",
    markdown: "format (use format: markdown instead of markdown: true)",
    html: "format (use format: html instead of a separate html key)",
  };

  for (const [wrong, correct] of Object.entries(textSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      const yaml = `
layout:
  direction: row
  children:
    - text: "Hello world"
      "${wrong}": some-value
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(
          `${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid text widget field; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// IFRAME_WIDGET_KEY_SUGGESTIONS: 6 entries
// Wrong field names inside an iframe widget node.
// ---------------------------------------------------------------------------

describe("IFRAME_WIDGET_KEY_SUGGESTIONS - exhaustive", () => {
  const iframeSuggestions: Record<string, string> = {
    ratio: "aspect_ratio",
    "aspect-ratio": "aspect_ratio",
    aspectRatio: "aspect_ratio",
    url: "iframe",
    src: "iframe",
    embed: "iframe",
  };

  for (const [wrong, correct] of Object.entries(iframeSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      const yaml = `
layout:
  direction: row
  children:
    - iframe: https://example.com/embed
      "${wrong}": some-value
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(
          `${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid iframe widget field; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// ADAPTER_PARAM_SUGGESTIONS.counter: 9 entries
// Wrong param keys in a counter adapter config.
// ---------------------------------------------------------------------------

describe("ADAPTER_PARAM_SUGGESTIONS.counter - exhaustive", () => {
  const counterSuggestions: Record<string, string> = {
    path: "json_path",
    jsonpath: "json_path",
    json: "json_path",
    endpoint: "url",
    api: "url",
    api_url: "url",
    name: "label",
    title: "label",
    suffix: "unit",
  };

  for (const [wrong, correct] of Object.entries(counterSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/v1/count
      json_path: data.count
      ${wrong}: some-value
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(
          `params\\.${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid counter param; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// ADAPTER_PARAM_SUGGESTIONS.bookmarks: 5 entries
// Wrong param keys in a bookmarks adapter config.
// ---------------------------------------------------------------------------

describe("ADAPTER_PARAM_SUGGESTIONS.bookmarks - exhaustive", () => {
  const bookmarksSuggestions: Record<string, string> = {
    links: "items",
    urls: "items",
    entries: "items",
    bookmarks: "items",
    list: "items",
  };

  for (const [wrong, correct] of Object.entries(bookmarksSuggestions)) {
    test(`"${wrong}" suggests "${correct}"`, () => {
      const yaml = `
adapters:
  - type: bookmarks
    params:
      ${wrong}:
        - title: Example
          url: https://example.com
layout:
  direction: row
  children:
    - panel: bookmarks
      source: bookmarks
`;
      setConfig(yaml);
      expect(() => loadConfig()).toThrow(
        new RegExp(
          `params\\.${wrong.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} is not a valid bookmarks param; did you mean "${correct.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
    });
  }
});

// ---------------------------------------------------------------------------
// Cross-cutting: verify that un-mapped wrong keys do NOT produce "did you
// mean" but instead produce a plain error without a suggestion.
// ---------------------------------------------------------------------------

describe("suggestion maps - unmapped keys produce no suggestion", () => {
  test("layout node with totally unknown key gives generic error", () => {
    const yaml = `
layout:
  direction: row
  children:
    - zzz_unknown: "something"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /must define one of: panel, direction, image, text, iframe/,
    );
    // Should NOT contain "did you mean"
    try {
      loadConfig();
    } catch (e: unknown) {
      expect((e as Error).message).not.toContain("did you mean");
    }
  });

  test("image widget with totally unknown field gives generic error", () => {
    const yaml = `
layout:
  direction: row
  children:
    - image: https://example.com/logo.png
      zzz_unknown: "something"
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /zzz_unknown is not a valid image widget field/,
    );
    try {
      loadConfig();
    } catch (e: unknown) {
      expect((e as Error).message).not.toContain("did you mean");
    }
  });

  test("counter adapter with totally unknown param gives generic error", () => {
    const yaml = `
adapters:
  - type: counter
    params:
      url: https://api.example.com/count
      json_path: data.count
      zzz_unknown: "something"
layout:
  direction: row
  children:
    - panel: stats
      source: counter
      display: counter
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /zzz_unknown is not a valid counter param/,
    );
    try {
      loadConfig();
    } catch (e: unknown) {
      expect((e as Error).message).not.toContain("did you mean");
    }
  });

  test("bookmarks adapter with totally unknown param gives generic error", () => {
    const yaml = `
adapters:
  - type: bookmarks
    params:
      items:
        - title: Example
          url: https://example.com
      zzz_unknown: "something"
layout:
  direction: row
  children:
    - panel: bookmarks
      source: bookmarks
`;
    setConfig(yaml);
    expect(() => loadConfig()).toThrow(
      /zzz_unknown is not a valid bookmarks param/,
    );
    try {
      loadConfig();
    } catch (e: unknown) {
      expect((e as Error).message).not.toContain("did you mean");
    }
  });
});
