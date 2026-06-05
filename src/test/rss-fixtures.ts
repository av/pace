export type RssItemFixture = {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
  contentEncoded?: string;
  /** Extra link elements (e.g. rel="alternate" href="..."). */
  extraLinks?: Array<{ rel?: string; href: string }>;
};

export type RssFeedOptions = {
  title?: string;
  items: RssItemFixture[];
};

export type AtomEntryFixture = {
  title: string;
  link: string;
  updated?: string;
  summary?: string;
};

export type AtomFeedOptions = {
  title?: string;
  entries: AtomEntryFixture[];
};

const DEFAULT_RSS_ITEMS: RssItemFixture[] = [
  {
    title: "Item One",
    link: "https://example.com/one",
    pubDate: "Mon, 01 Jan 2024 12:00:00 GMT",
    description: "First item body text",
  },
  {
    title: "Item Two",
    link: "https://example.com/two",
    pubDate: "2024-01-02T00:00:00Z",
    description: "Second item body",
  },
];

function renderRssItem(item: RssItemFixture): string {
  const link = item.link ? `\n      <link>${item.link}</link>` : "";
  const extraLinks = (item.extraLinks ?? [])
    .map((l) => {
      const rel = l.rel ? ` rel="${l.rel}"` : "";
      return `\n      <link${rel} href="${l.href}" />`;
    })
    .join("");
  const pubDate = item.pubDate ? `\n      <pubDate>${item.pubDate}</pubDate>` : "";
  const description = item.description ? `\n      <description>${item.description}</description>` : "";
  const contentEncoded = item.contentEncoded
    ? `\n      <content:encoded>${item.contentEncoded}</content:encoded>`
    : "";
  return `    <item>
      <title>${item.title}</title>${link}${extraLinks}${pubDate}${description}${contentEncoded}
    </item>`;
}

function renderRssFeed(options: RssFeedOptions): string {
  const items = options.items.map(renderRssItem).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${options.title ?? "Example RSS Feed"}</title>
${items}
  </channel>
</rss>`;
}

function renderAtomEntry(entry: AtomEntryFixture): string {
  const updated = entry.updated ? `\n    <updated>${entry.updated}</updated>` : "";
  const summary = entry.summary ? `\n    <summary>${entry.summary}</summary>` : "";
  return `  <entry>
    <title>${entry.title}</title>
    <link href="${entry.link}" rel="alternate" />${updated}${summary}
  </entry>`;
}

function renderAtomFeed(options: AtomFeedOptions): string {
  const entries = options.entries.map(renderAtomEntry).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${options.title ?? "Example Atom Feed"}</title>
${entries}
</feed>`;
}

/** Canonical two-item RSS 2.0 feed for adapter tests. */
export function rssTwoItemFeedFixture(): string {
  return renderRssFeed({ items: DEFAULT_RSS_ITEMS });
}

/** Single-entry Atom feed for adapter tests. */
export function atomFeedFixture(): string {
  return renderAtomFeed({
    entries: [
      {
        title: "Atom Item",
        link: "https://example.com/atom1",
        updated: "2024-01-03T00:00:00Z",
        summary: "Atom body content here",
      },
    ],
  });
}

/** RSS feed with mixed link array form (prefers alternate href). */
export function rssMixedLinkFeedFixture(): string {
  return `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Mixed Link Feed</title>
    <item>
      <title>Link Array Case</title>
      <link>https://example.com/alt</link>
      <link rel="alternate" href="https://example.com/real" />
      <pubDate>2024-01-04</pubDate>
      <description>body for link array</description>
    </item>
  </channel>
</rss>`;
}

/** RSS feed with overlapping item link for dedup tests. */
export function rssOverlapFeedFixture(): string {
  return renderRssFeed({
    title: "Overlap Feed",
    items: [
      {
        title: "Item One Duplicate",
        link: "https://example.com/one",
        pubDate: "2024-01-05T00:00:00Z",
        description: "from second feed",
      },
    ],
  });
}

/** RSS feed with HTML entities in channel and item titles. */
export function rssEntityTitlesFeedFixture(): string {
  return renderRssFeed({
    title: "Chan &amp; Co &#8364;",
    items: [
      {
        title: "Rock &amp; Roll &#8364;",
        link: "https://example.com/entity",
        pubDate: "2024-01-08T00:00:00Z",
        description: "body",
      },
    ],
  });
}

/** Atom feed with HTML entities in feed and entry titles. */
export function atomEntityTitlesFeedFixture(): string {
  return renderAtomFeed({
    title: "Atom &amp; Feed &#8364;",
    entries: [
      {
        title: "Atom &amp; Entry &#8364;",
        link: "https://example.com/atom-entity",
        updated: "2024-01-09T00:00:00Z",
        summary: "atom body",
      },
    ],
  });
}

/** RSS feed with CDATA HTML in description and content:encoded bodies. */
export function rssHtmlBodyFeedFixture(): string {
  return renderRssFeed({
    title: "HTML Body Feed",
    items: [
      {
        title: "HTML Item",
        link: "https://example.com/html",
        pubDate: "2024-01-06T00:00:00Z",
        description: "<![CDATA[<p>Hello &amp; <b>world</b></p>]]>",
      },
      {
        title: "Encoded Item",
        link: "https://example.com/encoded",
        pubDate: "2024-01-07T00:00:00Z",
        contentEncoded: "<![CDATA[<p>Line &#65; <em>one</em></p>]]>",
      },
    ],
  });
}

/** RSS feed with no channel title element (extractHostname fallback). */
export function rssNoChannelTitleFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Item Without Channel Title</title>
      <link>https://example.com/notitle</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <description>body without channel title</description>
    </item>
  </channel>
</rss>`;
}

/** RSS feed with empty channel (no items) for contract tests. */
export function rssEmptyChannelFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;
}