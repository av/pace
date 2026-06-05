export function makeMostReadArticle(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    title: "Test_Article",
    extract: "This is a test article about something interesting.",
    description: "A test article",
    content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Test_Article" } },
    views: 50000,
    rank: 1,
    ...overrides,
  };
}

export function makeFeaturedResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tfa: {
      title: "Featured_Article",
      extract: "Today's featured article is about featured things.",
      description: "A featured article",
      content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Featured_Article" } },
    },
    mostread: {
      articles: [
        makeMostReadArticle(),
        makeMostReadArticle({ title: "Second_Article", views: 30000, rank: 2 }),
      ],
    },
    onthisday: [
      {
        text: "Something <b>important</b> happened.",
        year: 1969,
        pages: [
          {
            title: "Moon_Landing",
            description: "The Apollo 11 mission",
            content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Moon_Landing" } },
          },
        ],
      },
    ],
    news: [
      {
        story: "A <b>major event</b> occurred today.",
        links: [
          {
            title: "Major_Event",
            description: "Details about the event",
            content_urls: { desktop: { page: "https://en.wikipedia.org/wiki/Major_Event" } },
          },
        ],
      },
    ],
    ...overrides,
  };
}