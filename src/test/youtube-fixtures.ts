export type YoutubeEntryFixture = {
  videoId: string;
  title: string;
  link?: string;
  published?: string;
  description?: string;
  author?: string;
};

export type YoutubeFeedOptions = {
  title?: string;
  entries: YoutubeEntryFixture[];
  includeMediaNamespace?: boolean;
};

const DEFAULT_CHANNEL_ENTRIES: YoutubeEntryFixture[] = [
  {
    videoId: "vid1",
    title: "Video 1 Title",
    link: "https://www.youtube.com/watch?v=vid1",
    published: "2024-01-01T00:00:00Z",
    description: "Desc 1",
    author: "Chan1",
  },
  {
    videoId: "vid2",
    title: "Video 2 Title",
    link: "https://www.youtube.com/watch?v=vid2",
    published: "2024-01-02T00:00:00Z",
    description: "Desc 2",
  },
];

function renderYoutubeEntry(entry: YoutubeEntryFixture, includeMedia: boolean): string {
  const link = entry.link ? `\n    <link rel="alternate" href="${entry.link}" />` : "";
  const published = entry.published
    ? `\n    <published>${entry.published}</published>`
    : "";
  const mediaGroup =
    includeMedia && entry.description
      ? `\n    <media:group>\n      <media:description>${entry.description}</media:description>\n    </media:group>`
      : "";
  const author = entry.author ? `\n    <author><name>${entry.author}</name></author>` : "";
  return `  <entry>
    <yt:videoId>${entry.videoId}</yt:videoId>
    <title>${entry.title}</title>${link}${published}${mediaGroup}${author}
  </entry>`;
}

function renderYoutubeFeed(options: YoutubeFeedOptions): string {
  const includeMedia = options.includeMediaNamespace ?? true;
  const mediaNs = includeMedia ? ' xmlns:media="http://search.yahoo.com/mrss/"' : "";
  const entries = options.entries.map((entry) => renderYoutubeEntry(entry, includeMedia)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"${mediaNs}>
  <title>${options.title ?? "YouTube Feed"}</title>
${entries}
</feed>`;
}

/** Canonical two-entry channel feed for adapter tests. */
export function youtubeChannelOneFeedFixture(): string {
  return renderYoutubeFeed({
    title: "Channel One",
    entries: DEFAULT_CHANNEL_ENTRIES,
  });
}

/** Single-entry playlist feed for adapter tests. */
export function youtubePlaylistOneFeedFixture(): string {
  return renderYoutubeFeed({
    title: "Playlist One",
    entries: [
      {
        videoId: "pl1",
        title: "PL Video 1",
        link: "https://www.youtube.com/watch?v=pl1",
        published: "2024-02-01T00:00:00Z",
        description: "PL Desc",
      },
    ],
  });
}

/** Playlist feed with overlapping video id for dedup tests. */
export function youtubeOverlapPlaylistFeedFixture(): string {
  return renderYoutubeFeed({
    title: "Overlap Playlist",
    entries: [
      {
        videoId: "vid1",
        title: "Video 1 From Playlist",
        published: "2024-03-01T00:00:00Z",
      },
    ],
    includeMediaNamespace: false,
  });
}

/** Feed with HTML CDATA in media:description for stripHtml tests. */
export function youtubeHtmlDescriptionFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/">
  <title>HTML Desc Channel</title>
  <entry>
    <yt:videoId>html1</yt:videoId>
    <title>HTML Video</title>
    <published>2024-05-01T00:00:00Z</published>
    <media:group>
      <media:description><![CDATA[<p>Hello &amp; <b>world</b></p>]]></media:description>
    </media:group>
    <author><name>HTML Author</name></author>
  </entry>
</feed>`;
}

/** Feed with HTML entities in channel and entry titles. */
export function youtubeEntityTitlesFeedFixture(): string {
  return renderYoutubeFeed({
    title: "Chan &amp; Co &#8364;",
    entries: [
      {
        videoId: "ent1",
        title: "Rock &amp; Roll &#8364;",
        published: "2024-04-01T00:00:00Z",
      },
    ],
    includeMediaNamespace: false,
  });
}

/** Multi-entry channel feed for limit/cap/floor adapter tests. */
export function youtubeMultiEntryChannelFeedFixture(entryCount: number): string {
  const entries: YoutubeEntryFixture[] = Array.from({ length: entryCount }, (_, i) => {
    const n = entryCount - i;
    return {
      videoId: `vid${n}`,
      title: `Video ${n}`,
      published: `2024-01-${String(n).padStart(2, "0")}T00:00:00Z`,
    };
  });
  return renderYoutubeFeed({
    title: "Multi Channel",
    entries,
    includeMediaNamespace: false,
  });
}