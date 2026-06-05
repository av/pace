export function makePostView(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    post: {
      id: 1001,
      name: "Test Post Title",
      url: "https://example.com/article",
      body: "Post body text",
      ap_id: "https://lemmy.ml/post/1001",
      published: "2025-01-15T10:00:00Z",
      ...(overrides.post as object | undefined),
    },
    creator: {
      name: "testuser",
      actor_id: "https://lemmy.ml/u/testuser",
      ...(overrides.creator as object | undefined),
    },
    community: {
      name: "technology",
      title: "Technology",
      actor_id: "https://lemmy.ml/c/technology",
      ...(overrides.community as object | undefined),
    },
    counts: {
      score: 42,
      upvotes: 50,
      downvotes: 8,
      comments: 15,
      ...(overrides.counts as object | undefined),
    },
  };
}

export function makePostListResponse(posts: Record<string, unknown>[]) {
  return { posts };
}