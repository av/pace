import { makeJsonResponse } from "./fetch-responses";

export interface DevToArticleFixture {
  id: number;
  title: string;
  url: string;
  description: string;
  published_at: string;
  reading_time_minutes: number;
  positive_reactions_count: number;
  comments_count: number;
  user: { username: string; name: string };
  tag_list: string[];
  cover_image: string | null;
}

export function makeDevToArticle(
  id: number,
  overrides: Partial<DevToArticleFixture> = {},
): DevToArticleFixture {
  return {
    id,
    title: `Article ${id}`,
    url: `https://dev.to/article-${id}`,
    description: "",
    published_at: "2024-01-15T10:00:00Z",
    reading_time_minutes: 5,
    positive_reactions_count: 42,
    comments_count: 3,
    user: { username: "testuser", name: "Test User" },
    tag_list: ["typescript"],
    cover_image: null,
    ...overrides,
  };
}

const devtoUserArticle = makeDevToArticle(101, {
  title: "User Article",
  url: "https://dev.to/testuser/article1",
  description: "A user post",
  cover_image: "https://example.com/cover.jpg",
});

const devtoTagTypescriptArticle = makeDevToArticle(201, {
  title: "Tag Article One",
  url: "https://dev.to/tag1",
  description: "Tag post 1",
  published_at: "2024-01-16T12:00:00Z",
  reading_time_minutes: 8,
  positive_reactions_count: 100,
  comments_count: 10,
  user: { username: "other", name: "Other" },
  tag_list: ["typescript", "bun"],
});

const devtoTagReactArticle = makeDevToArticle(301, {
  title: "React Post",
  url: "https://dev.to/react",
  published_at: "2024-01-17T00:00:00Z",
  reading_time_minutes: 12,
  positive_reactions_count: 7,
  comments_count: 1,
  user: { username: "dev", name: "Dev" },
  tag_list: ["react"],
});

export async function devtoDefaultFetchMock(
  input: RequestInfo | URL,
  _init?: RequestInit,
): Promise<Response> {
  const url = String(input);
  if (url.includes("username=testuser")) {
    return makeJsonResponse([devtoUserArticle]);
  }
  if (url.includes("tag=typescript")) {
    return makeJsonResponse([devtoTagTypescriptArticle]);
  }
  if (url.includes("tag=react")) {
    return makeJsonResponse([devtoTagReactArticle]);
  }
  return makeJsonResponse([]);
}