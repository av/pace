import { makeJsonResponse } from "./fetch-responses";

export interface RedditPostDataFixture {
  id: string;
  title: string;
  permalink: string;
  url: string;
  selftext: string;
  is_self: boolean;
  created_utc: number;
  subreddit: string;
  score: number;
  num_comments: number;
  author: string;
}

export function makePost(
  id: string,
  title = "Test Post",
  isSelf = false,
  score = 100,
  sub = "test",
): RedditPostDataFixture {
  return {
    id,
    title,
    permalink: `/r/${sub}/comments/${id}/test_post/`,
    url: isSelf ? "" : `https://example.com/link-${id}`,
    selftext: isSelf ? "self text here" : "",
    is_self: isSelf,
    created_utc: 1716200000 + parseInt(id, 36),
    subreddit: sub,
    score,
    num_comments: 10,
    author: "tester",
  };
}

export function makeListingResponse(posts: RedditPostDataFixture[]): Response {
  const children = posts.map((p) => ({ data: p }));
  return makeJsonResponse({ data: { children } });
}