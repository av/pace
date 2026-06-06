import { fetchMockCalls, type FetchMockSuite } from "./adapter-mocks";

export interface MastodonStatusFixture {
  id: string;
  uri: string;
  url: string;
  content: string;
  created_at: string;
  reblogs_count: number;
  favourites_count: number;
  replies_count: number;
  account: {
    id: string;
    username: string;
    acct: string;
    display_name: string;
    url: string;
  };
  media_attachments: [];
  tags: [];
  spoiler_text: string;
  reblog: null;
}

export function makeStatus(id: string, content: string, created: string): MastodonStatusFixture {
  return {
    id,
    uri: `https://ex.com/status/${id}`,
    url: `https://ex.com/@u/${id}`,
    content,
    created_at: created,
    reblogs_count: 3,
    favourites_count: 7,
    replies_count: 1,
    account: {
      id: "a1",
      username: "u",
      acct: "u",
      display_name: "U",
      url: "https://ex.com/@u",
    },
    media_attachments: [],
    tags: [],
    spoiler_text: "",
    reblog: null,
  };
}

export function fetchUrls(mocks: FetchMockSuite): string[] {
  return fetchMockCalls(mocks.fetchMock).map((c) => c.url);
}