export type GitHubReleaseEntryFixture = {
  id?: string;
  title: string;
  link?: string;
  updated?: string;
  published?: string;
  content?: string;
  contentType?: "html";
};

export type GitHubReleasesFeedOptions = {
  feedTitle?: string;
  entries: GitHubReleaseEntryFixture[];
};

const DEFAULT_GITHUB_RELEASE_ENTRIES: GitHubReleaseEntryFixture[] = [
  {
    id: "tag:github.com,2008:Repository/10270250/v19.0.0",
    title: "Release v19.0.0",
    link: "https://github.com/facebook/react/releases/tag/v19.0.0",
    updated: "2024-12-01T12:00:00Z",
    content: "&lt;p&gt;Bug fixes and new features in React 19.&lt;/p&gt;",
    contentType: "html",
  },
  {
    id: "tag:github.com,2008:Repository/10270250/v18.3.0",
    title: "Release v18.3.0",
    link: "https://github.com/facebook/react/releases/tag/v18.3.0",
    published: "2024-06-01T00:00:00Z",
    content: "Minor updates.",
    contentType: "html",
  },
];

function renderGitHubReleaseEntry(entry: GitHubReleaseEntryFixture): string {
  const id = entry.id ? `    <id>${entry.id}</id>\n` : "";
  const updated = entry.updated ? `    <updated>${entry.updated}</updated>\n` : "";
  const published = entry.published ? `    <published>${entry.published}</published>\n` : "";
  const link =
    entry.link !== undefined
      ? `    <link rel="alternate" type="text/html" href="${entry.link}"/>\n`
      : "";
  const content =
    entry.content !== undefined
      ? `    <content type="${entry.contentType ?? "html"}">${entry.content}</content>\n`
      : "";

  return `  <entry>
${id}    <title>${entry.title}</title>
${link}${updated}${published}${content}  </entry>`;
}

function renderGitHubReleasesAtomFeed(options: GitHubReleasesFeedOptions): string {
  const feedTitle = options.feedTitle
    ? `  <title>${options.feedTitle}</title>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
${feedTitle}${options.entries.map(renderGitHubReleaseEntry).join("\n")}
</feed>`;
}

/** Canonical two-entry GitHub releases.atom feed for adapter tests. */
export function githubReleasesAtomFeedFixture(): string {
  return renderGitHubReleasesAtomFeed({ entries: DEFAULT_GITHUB_RELEASE_ENTRIES });
}

/** Releases.atom feed with HTML entities in the feed title. */
export function githubReleasesEntityFeedTitleFixture(): string {
  return renderGitHubReleasesAtomFeed({
    feedTitle: "Release &amp; Notes &#8364;",
    entries: [
      {
        title: "v1.0.0",
        link: "https://github.com/acme/pkg/releases/tag/v1.0.0",
        updated: "2024-12-01T12:00:00Z",
      },
    ],
  });
}

/** Releases.atom feed with HTML entities in an entry title. */
export function githubReleasesEntityEntryTitleFixture(): string {
  return renderGitHubReleasesAtomFeed({
    entries: [
      {
        title: "Rock &amp; Roll &#8364;",
        link: "https://github.com/acme/pkg/releases/tag/v1.0.0",
        updated: "2024-12-01T12:00:00Z",
      },
    ],
  });
}

/** Releases.atom feed with HTML tags/entities in entry content for stripHtml tests. */
export function githubReleasesHtmlBodyFixture(): string {
  return renderGitHubReleasesAtomFeed({
    entries: [
      {
        title: "v1.0.0",
        link: "https://github.com/acme/pkg/releases/tag/v1.0.0",
        updated: "2024-12-01T12:00:00Z",
        content:
          '&lt;p&gt;See &lt;a href="https://docs.example.com"&gt;docs&lt;/a&gt; for &#65; details&lt;/p&gt;',
        contentType: "html",
      },
    ],
  });
}

/** Canonical GitHub trending HTML page for adapter tests. */
export function githubTrendingHtmlFixture(): string {
  return `
<article class="Box-row">
  <h2><a href="/vercel/next.js">vercel/next.js</a></h2>
  <p class="col-9">The React Framework for the Web</p>
  <span itemprop="programmingLanguage">TypeScript</span>
  <svg class="octicon-star">star icon</svg>  123,456
  <span>2,345 stars today</span>
</article>
<article class="Box-row">
  <h2><a href="/owner/html-demo">owner/html-demo</a></h2>
  <p class="col-9 color-fg-muted"><a href="/owner/html-demo">Tools &amp; &#39;kit&#39; for &#x42;uilders</a></p>
  <span itemprop="programmingLanguage">Rust</span>
  <svg class="octicon-star">star</svg>  1,000
</article>
<article class="Box-row">
  <h2><a href="/facebook/react">facebook/react</a></h2>
  <p class="col-9 something">A declarative JavaScript library</p>
  <span itemprop="programmingLanguage">JavaScript</span>
  <svg>octicon-star</svg>  987,654
</article>
`;
}

/** Trending HTML with HTML entities in repo name/title for decode tests. */
export function githubTrendingEntityHtmlFixture(): string {
  return `
<article class="Box-row">
  <h2><a href="/acme/lib&amp;tools">acme / lib&amp;tools</a></h2>
  <p class="col-9">A &amp; &#8364; toolkit</p>
  <span itemprop="programmingLanguage">TypeScript</span>
  <svg class="octicon-star">star</svg>  500
</article>`;
}