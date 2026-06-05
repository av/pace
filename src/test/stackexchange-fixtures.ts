import { makeJsonResponse } from "./fetch-responses";

export function makeQuestion(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    question_id: 123,
    title: "How to use Bun with TypeScript?",
    link: "https://stackoverflow.com/questions/123",
    score: 42,
    answer_count: 3,
    view_count: 1500,
    tags: ["typescript", "bun"],
    owner: { display_name: "bunfan" },
    creation_date: 1700000000,
    is_answered: true,
    accepted_answer_id: 456,
    ...overrides,
  };
}

export function makeApiResponse(
  items: unknown[],
  overrides: Partial<{ has_more: boolean; quota_remaining: number }> = {},
): Response {
  return makeJsonResponse({
    items,
    has_more: false,
    quota_remaining: 100,
    ...overrides,
  });
}