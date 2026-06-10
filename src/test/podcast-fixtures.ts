export type PodcastEpisodeFixture = {
  title: string;
  link?: string;
  pubDate?: string;
  description?: string;
  enclosureUrl?: string;
  enclosureType?: string;
  duration?: string;
  episode?: string;
  season?: string;
  author?: string;
};

export type PodcastFeedOptions = {
  showTitle?: string;
  showLink?: string;
  episodes?: PodcastEpisodeFixture[];
  itunes?: boolean;
};

const DEFAULT_PODCAST_EPISODES: PodcastEpisodeFixture[] = [
  {
    title: "Episode One Title",
    link: "https://example.com/ep1",
    enclosureUrl: "https://audio.com/ep1.mp3",
    enclosureType: "audio/mpeg",
    pubDate: "Mon, 01 Jan 2024 10:00:00 GMT",
    duration: "12:34",
    description: "Some desc here with &amp; stuff",
    episode: "1",
    season: "1",
    author: "Host One",
  },
  {
    title: "Episode Two",
    enclosureUrl: "https://audio.com/ep2.mp3",
    pubDate: "2024-01-02",
    description: "Second episode short",
  },
  {
    title: "Bad Item No Title",
  },
];

function renderPodcastEpisode(episode: PodcastEpisodeFixture, itunes: boolean): string {
  const enclosureType = episode.enclosureType ? ` type="${episode.enclosureType}"` : "";
  const enclosure = episode.enclosureUrl
    ? `\n      <enclosure url="${episode.enclosureUrl}"${enclosureType} />`
    : "";
  const pubDate = episode.pubDate ? `\n      <pubDate>${episode.pubDate}</pubDate>` : "";
  const description = episode.description
    ? `\n      <description>${episode.description}</description>`
    : "";
  const itunesBlocks = itunes
    ? [
        episode.duration ? `\n      <itunes:duration>${episode.duration}</itunes:duration>` : "",
        episode.episode ? `\n      <itunes:episode>${episode.episode}</itunes:episode>` : "",
        episode.season ? `\n      <itunes:season>${episode.season}</itunes:season>` : "",
        episode.author ? `\n      <itunes:author>${episode.author}</itunes:author>` : "",
      ].join("")
    : "";
  const link = episode.link ? `\n      <link>${episode.link}</link>` : "";
  return `    <item>
      <title>${episode.title}</title>${link}${enclosure}${pubDate}${description}${itunesBlocks}
    </item>`;
}

function resolvePodcastFeedOptions(options?: PodcastFeedOptions): Required<
  Pick<PodcastFeedOptions, "showTitle" | "showLink" | "episodes" | "itunes">
> {
  return {
    showTitle: options?.showTitle ?? "Test Podcast Show",
    showLink: options?.showLink ?? "https://example.com/podcast",
    episodes: options?.episodes ?? DEFAULT_PODCAST_EPISODES,
    itunes: options?.itunes ?? true,
  };
}

/** Canonical podcast RSS feed XML for adapter tests. */
export function podcastFeedFixture(options?: PodcastFeedOptions): string {
  const { showTitle, showLink, episodes, itunes } = resolvePodcastFeedOptions(options);
  const xmlns = itunes
    ? ' xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"'
    : "";
  const items = episodes.map((ep) => renderPodcastEpisode(ep, itunes)).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"${xmlns}>
  <channel>
    <title>${showTitle}</title>
    <link>${showLink}</link>
${items}
  </channel>
</rss>`;
}

/** RSS feed with no channel element. */
export function podcastNoChannelFixture(): string {
  return `<?xml version="1.0"?><rss><foo>no channel</foo></rss>`;
}

/** RSS feed with channel but no episode items. */
export function podcastEmptyFeedFixture(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Podcast Show</title>
    <link>https://example.com/empty-podcast</link>
  </channel>
</rss>`;
}

/** Multi-episode feed for limit/cap/floor adapter tests. */
export function podcastMultiEpisodeFeedFixture(episodeCount: number): string {
  const episodes: PodcastEpisodeFixture[] = Array.from({ length: episodeCount }, (_, i) => {
    const n = episodeCount - i;
    return {
      title: `Episode ${n}`,
      link: `https://example.com/ep${n}`,
      pubDate: `Mon, ${String(n).padStart(2, "0")} Jan 2024 10:00:00 GMT`,
    };
  });
  return podcastFeedFixture({
    showTitle: "Limit Test Show",
    episodes,
    itunes: false,
  });
}

/** Single-episode feed with a long description for truncation tests. */
export function podcastLongDescriptionFeedFixture(description: string): string {
  return podcastFeedFixture({
    showTitle: "Long Desc Show",
    episodes: [
      {
        title: "Long Desc Ep",
        link: "https://example.com/long",
        pubDate: "Mon, 01 Jan 2024 10:00:00 GMT",
        description,
      },
    ],
    itunes: false,
  });
}