import { describe, test, expect } from "bun:test";
import { validateTransforms } from "./transform-validate";

describe("config validation: fetch_content on llm-summarize", () => {
  test("accepts fetch_content: true on llm-summarize", () => {
    expect(() =>
      validateTransforms([{ type: "llm-summarize", fetch_content: true }], "transforms"),
    ).not.toThrow();
  });

  test("accepts private network opt-in on llm-summarize", () => {
    expect(() => validateTransforms([{
      type: "llm-summarize",
      fetch_content: true,
      fetch_content_allow_private: true,
    }], "transforms")).not.toThrow();
  });

  test("rejects non-boolean private network opt-in", () => {
    expect(() => validateTransforms([{
      type: "llm-summarize",
      fetch_content_allow_private: "yes",
    }], "transforms")).toThrow(/fetch_content_allow_private/);
  });

  test("accepts fetch_content: false on llm-summarize", () => {
    expect(() =>
      validateTransforms([{ type: "llm-summarize", fetch_content: false }], "transforms"),
    ).not.toThrow();
  });

  test("accepts llm-summarize without fetch_content (default)", () => {
    expect(() =>
      validateTransforms([{ type: "llm-summarize" }], "transforms"),
    ).not.toThrow();
  });

  test("rejects non-boolean fetch_content on llm-summarize", () => {
    expect(() =>
      validateTransforms([{ type: "llm-summarize", fetch_content: "yes" }], "transforms"),
    ).toThrow(/fetch_content/);
  });

  test("rejects fetch_content on llm-filter (unknown field)", () => {
    expect(() =>
      validateTransforms(
        [{ type: "llm-filter", criteria: "keep tech news", fetch_content: true }],
        "transforms",
      ),
    ).toThrow(/fetch_content.*not a valid/);
  });

  test("rejects fetch_content on llm-rank (unknown field)", () => {
    expect(() =>
      validateTransforms(
        [{ type: "llm-rank", fetch_content: true }],
        "transforms",
      ),
    ).toThrow(/fetch_content.*not a valid/);
  });

  test("rejects fetch_content on llm-merge (unknown field)", () => {
    expect(() =>
      validateTransforms(
        [{ type: "llm-merge", fetch_content: true }],
        "transforms",
      ),
    ).toThrow(/fetch_content.*not a valid/);
  });

  test("rejects fetch_content on non-llm transform (e.g. sort)", () => {
    expect(() =>
      validateTransforms(
        [{ type: "sort", field: "timestamp", fetch_content: true }],
        "transforms",
      ),
    ).toThrow(/fetch_content.*not a valid/);
  });
});
