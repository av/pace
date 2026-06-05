export type ArxivEntryFixture = {
  title: string;
  arxivId: string;
  author?: string;
  cat?: string;
  summary?: string;
  published?: string;
  updated?: string;
};

export type ArxivFeedOptions = {
  entries: ArxivEntryFixture[];
};

function renderArxivEntry(entry: ArxivEntryFixture): string {
  const author = entry.author ?? "Test Author";
  const cat = entry.cat ?? "cs.AI";
  const summary =
    entry.summary ?? `This is the abstract for ${entry.title} about research.`;
  const published = entry.published ?? "2024-05-20T12:00:00Z";
  const updated = entry.updated
    ? `\n    <updated>${entry.updated}</updated>`
    : entry.summary === undefined
      ? `\n    <updated>2024-05-21T10:00:00Z</updated>`
      : "";
  return `  <entry>
    <id>http://arxiv.org/abs/${entry.arxivId}v1</id>
    <title>${entry.title}</title>
    <summary>${summary}</summary>
    <published>${published}</published>${updated}
    <author><name>${author}</name></author>
    <arxiv:primary_category term="${cat}" />
    <category term="${cat}" />
    <link href="http://arxiv.org/abs/${entry.arxivId}v1" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/${entry.arxivId}" type="application/pdf" />
  </entry>`;
}

function renderArxivFeed(entries: ArxivEntryFixture[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
${entries.map(renderArxivEntry).join("\n")}
</feed>`;
}

/** Canonical arXiv Atom feed XML for adapter tests. */
export function arxivFeedFixture(
  title: string,
  arxivId: string,
  author = "Test Author",
  cat = "cs.AI",
): string {
  return renderArxivFeed([{ title, arxivId, author, cat }]);
}

/** Multi-entry arXiv feed for dedup/limit adapter tests. */
export function arxivMultiEntryFeedFixture(entries: ArxivEntryFixture[]): string {
  return renderArxivFeed(entries);
}

/** Feed with HTML entities in the abstract field. */
export function arxivEntityAbstractFeedFixture(): string {
  return arxivMultiEntryFeedFixture([
    {
      title: "Entity Abstract Paper",
      arxivId: "2401.00003",
      summary: "Rock &amp; Roll &#8364; in the abstract field.",
    },
  ]);
}

/** Feed with double-encoded HTML entities in the abstract field. */
export function arxivDoubleEncodedAbstractFeedFixture(): string {
  return arxivMultiEntryFeedFixture([
    {
      title: "Double-encoded Abstract",
      arxivId: "2401.00004",
      summary: "Rock &amp;amp; Roll &amp;#8364; in the abstract field.",
    },
  ]);
}

/** Feed with a long abstract for truncation tests. */
export function arxivLongAbstractFeedFixture(longAbstract: string): string {
  return arxivMultiEntryFeedFixture([
    {
      title: "Long Abstract Paper",
      arxivId: "2401.00999",
      summary: longAbstract,
    },
  ]);
}

/** Feed with HTML tags/entities in title and summary for stripHtml tests. */
export function arxivHtmlStripFeedFixture(): string {
  return arxivMultiEntryFeedFixture([
    {
      title: "&lt;em&gt;Deep&lt;/em&gt; &amp;amp; Wide",
      arxivId: "2401.00001",
      summary:
        '&lt;p&gt;See &lt;a href="https://example.com/paper"&gt;paper&lt;/a&gt; for &#65; details&lt;/p&gt;',
    },
  ]);
}

/** Overlapping category + query results for dedup adapter tests. */
export function arxivDedupOverlapQueryFeedFixture(): string {
  return arxivMultiEntryFeedFixture([
    {
      title: "Overlap",
      arxivId: "2501.0001",
      summary: "s",
      author: "A",
      published: "2024-01-01",
    },
    {
      title: "New",
      arxivId: "2501.0002",
      summary: "s",
      author: "B",
      published: "2024-01-02",
    },
  ]);
}

/** Compact multi-entry feed for per-source limit tests. */
export function arxivLimitMultiEntryFeedFixture(count: number): string {
  const entries: ArxivEntryFixture[] = Array.from({ length: count }, (_, i) => ({
    title: `P${i + 1}`,
    arxivId: String(i + 1),
    summary: "s",
    author: "X",
    published: "2024-01-01",
  }));
  return arxivMultiEntryFeedFixture(entries);
}