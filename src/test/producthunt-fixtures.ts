export type ProductHuntFeedEntry = {
  postId: string;
  title: string;
  content: string;
  slug: string;
  published?: string;
  author?: string;
  contentType?: "html";
  linkRel?: "alternate";
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
  return `  <entry>
    <id>tag:www.producthunt.com,2005:Post/${entry.postId}</id>
    <title>${entry.title}</title>
    <content${contentAttr}>${entry.content}</content>
    <link${linkAttr} href="https://www.producthunt.com/posts/${entry.slug}" />
    <published>${entry.published ?? "2024-05-20T10:00:00Z"}</published>${authorBlock}
  </entry>`;
}

/** Canonical ProductHunt Atom feed XML for adapter tests. */
export function productHuntFeedFixture(entryCount?: number): string {
  const entries = DEFAULT_PRODUCTHUNT_ENTRIES.slice(
    0,
    entryCount ?? DEFAULT_PRODUCTHUNT_ENTRIES.length,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${entries.map(renderProductHuntFeedEntry).join("\n")}
</feed>`;
}