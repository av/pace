export type ProductHuntFeedEntry = {
  postId: string;
  title: string;
  content: string;
  slug: string;
  published?: string;
  author?: string;
  contentType?: "html";
  contentCdata?: string;
  linkRel?: "alternate";
};

export type ProductHuntFeedOptions = {
  feedTitle?: string;
  entries?: ProductHuntFeedEntry[];
};

const DEFAULT_PRODUCTHUNT_ENTRIES: ProductHuntFeedEntry[] = [
  {
    postId: "123456",
    title: "Test Product",
    content:
      '&lt;p&gt;Cool new AI tool tagline&lt;/p&gt;&lt;p&gt;&lt;a href="https://www.producthunt.com/r/test-product-123456"&gt;Link&lt;/a&gt;&lt;/p&gt;',
    slug: "test-product-123456",
    published: "2024-05-20T10:00:00Z",
    author: "John Doe",
    contentType: "html",
    linkRel: "alternate",
  },
  {
    postId: "789012",
    title: "Another Great Product",
    content: "&lt;p&gt;Second tagline here&lt;/p&gt;",
    slug: "another-great-product-789012",
    published: "2024-05-21T12:00:00Z",
    author: "Jane Smith",
  },
];

function renderProductHuntFeedEntry(entry: ProductHuntFeedEntry): string {
  const contentAttr = entry.contentType ? ` type="${entry.contentType}"` : "";
  const linkAttr = entry.linkRel ? ` rel="${entry.linkRel}"` : "";
  const authorBlock = entry.author
    ? `\n    <author><name>${entry.author}</name></author>`
    : "";
  const contentBody = entry.contentCdata
    ? `<![CDATA[${entry.contentCdata}]]>`
    : entry.content;
  return `  <entry>
    <id>tag:www.producthunt.com,2005:Post/${entry.postId}</id>
    <title>${entry.title}</title>
    <content${contentAttr}>${contentBody}</content>
    <link${linkAttr} href="https://www.producthunt.com/posts/${entry.slug}" />
    <published>${entry.published ?? "2024-05-20T10:00:00Z"}</published>${authorBlock}
  </entry>`;
}

function resolveProductHuntFeedOptions(
  options?: number | ProductHuntFeedOptions,
): { entries: ProductHuntFeedEntry[]; feedTitle?: string } {
  if (typeof options === "number") {
    return { entries: DEFAULT_PRODUCTHUNT_ENTRIES.slice(0, options) };
  }
  return {
    entries: options?.entries ?? DEFAULT_PRODUCTHUNT_ENTRIES,
    feedTitle: options?.feedTitle,
  };
}

/** Canonical ProductHunt Atom feed XML for adapter tests. */
export function productHuntFeedFixture(options?: number | ProductHuntFeedOptions): string {
  const { entries, feedTitle } = resolveProductHuntFeedOptions(options);
  const titleBlock = feedTitle ? `  <title>${feedTitle}</title>\n` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${titleBlock}${entries.map(renderProductHuntFeedEntry).join("\n")}
</feed>`;
}

/** Empty ProductHunt Atom feed (no entries). */
export function productHuntEmptyFeedFixture(): string {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
}

/** Synthetic entries for limit/cap/floor adapter tests. */
export function productHuntSyntheticEntries(
  count: number,
  opts: {
    idBase: number;
    titlePrefix: string;
    taglinePrefix: string;
    slugPrefix: string;
  },
): ProductHuntFeedEntry[] {
  return Array.from({ length: count }, (_, i) => ({
    postId: String(opts.idBase + i),
    title: `${opts.titlePrefix} ${i}`,
    content: `&lt;p&gt;${opts.taglinePrefix} ${i}&lt;/p&gt;`,
    slug: `${opts.slugPrefix}-${i}-${opts.idBase + i}`,
    linkRel: "alternate" as const,
  }));
}

export function productHuntEntityFeedTitleFixture(): string {
  return productHuntFeedFixture({
    feedTitle: "Product &amp; Hunt &#8364;",
    entries: [
      {
        postId: "555002",
        title: "Feed Title Product",
        content: "&lt;p&gt;Tagline&lt;/p&gt;",
        slug: "feed-title-product-555002",
        published: "2024-05-24T10:00:00Z",
        author: "Pat Lee",
        linkRel: "alternate",
      },
    ],
  });
}

export function productHuntEntityEntryTitleFixture(): string {
  return productHuntFeedFixture({
    entries: [
      {
        postId: "555001",
        title: "Rock &amp; Roll &#8364;",
        content: "&lt;p&gt;Entity tagline&lt;/p&gt;",
        slug: "entity-title-555001",
        published: "2024-05-23T10:00:00Z",
        author: "Pat Lee",
        linkRel: "alternate",
      },
    ],
  });
}

export function productHuntHtmlContentFeedFixture(): string {
  return productHuntFeedFixture({
    entries: [
      {
        postId: "999001",
        title: "HTML Product",
        content: "",
        contentType: "html",
        contentCdata:
          '<p>Hello &amp; <b>world</b></p><p><a href="https://www.producthunt.com/r/html-product">Link</a></p>',
        slug: "html-product-999001",
        published: "2024-05-22T08:00:00Z",
        author: "Pat Lee",
        linkRel: "alternate",
      },
    ],
  });
}

/** ProductHunt post page HTML for enrich adapter tests. */
export function productHuntEnrichHtml(
  upvotes: number,
  comments: number,
  topics: string[] = ["ai"],
  makers: string[] = ["johndoe"],
  topicLabels = false,
): string {
  const topicsHtml = topicLabels
    ? topics.map((t) => `<span data-test="topic-link">${t}</span>`).join("")
    : topics
        .map((t) => `<a href="/topics/${t.replace(/\s+/g, "-")}">${t}</a>`)
        .join("");
  const makersHtml = makers.map((m) => `<a href="/@${m}">@${m}</a>`).join("");
  return `<html><body>
    <div>Upvote • ${upvotes} points</div>
    <script>var x = {"commentsCount": ${comments}};</script>
    ${topicsHtml}
    ${makersHtml}
  </body></html>`;
}