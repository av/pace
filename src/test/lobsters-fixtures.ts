export interface LobstersFixture {
  short_id: string;
  title: string;
  url: string;
  score: number;
  comment_count: number;
  comments_url: string;
  submitter_user: string;
  created_at: string;
  tags: string[];
}

export function makeLobstersItem(overrides: Partial<LobstersFixture> = {}): LobstersFixture {
  return {
    short_id: "abc123",
    title: "Example Lobsters Post",
    url: "https://example.com/post",
    score: 42,
    comment_count: 7,
    comments_url: "https://lobste.rs/s/abc123",
    submitter_user: "alice",
    created_at: "2024-05-20T12:00:00Z",
    tags: ["programming"],
    ...overrides,
  };
}