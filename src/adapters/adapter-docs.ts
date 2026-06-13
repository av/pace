import type { AdapterType } from "./params";

export type AdapterParamDoc = {
  type: string;
  required?: true;
  default?: string;
  constraints?: string;
  description: string;
};

export type AdapterDoc = {
  summary: string;
  example: string; // YAML string
  params: Record<string, AdapterParamDoc>;
};

export const ADAPTER_DOCS: Record<AdapterType, AdapterDoc> = {
  hackernews: {
    summary: "Fetches stories from Hacker News.",
    example: `type: hackernews
params:
  feed: top
  limit: 30`,
    params: {
      type: {
        type: "string",
        default: "top",
        constraints: "top|new|best|ask|show|job",
        description:
          "Feed type alias (highest priority among type/feed/stories). Accepts same values as feed.",
      },
      feed: {
        type: "string",
        default: "top",
        constraints: "top|new|best|ask|show|job",
        description:
          "Feed type to fetch. Takes priority over 'stories'. Aliases: newest/recent→new, front/frontpage→top, askhn/ask_hn→ask, showhn/show_hn→show, jobs→job.",
      },
      stories: {
        type: "string",
        default: "top",
        constraints: "top|new|best|ask|show|job",
        description:
          "Feed type alias (lowest priority among type/feed/stories). Accepts same values as feed.",
      },
      limit: {
        type: "number",
        default: "30",
        constraints: "max 200",
        description: "Maximum number of stories to return.",
      },
      min_score: {
        type: "number",
        default: "0",
        description: "Minimum score threshold for stories.",
      },
    },
  },

  lobsters: {
    summary: "Fetches stories from Lobsters.",
    example: `type: lobsters
params:
  feed: hottest
  limit: 25`,
    params: {
      feed: {
        type: "string",
        default: "hottest",
        constraints: "hottest|newest|active",
        description:
          "Feed type to fetch. Aliases: hot/front→hottest, new/recent→newest.",
      },
      limit: {
        type: "number",
        default: "25",
        constraints: "max 100",
        description: "Maximum number of stories to return.",
      },
      min_score: {
        type: "number",
        default: "0",
        description: "Minimum score threshold for stories.",
      },
      tags: {
        type: "string[]",
        description: "Filter stories by tags.",
      },
    },
  },

  rss: {
    summary: "Fetches items from one or more RSS/Atom feeds.",
    example: `type: rss
params:
  urls:
    - https://example.com/feed.xml`,
    params: {
      urls: {
        type: "string[]",
        required: true,
        description: "List of RSS/Atom feed URLs to fetch.",
      },
      limit: {
        type: "number",
        constraints: "max 200",
        description:
          "Maximum number of items to return per feed. Omit for unlimited.",
      },
    },
  },

  reddit: {
    summary: "Fetches posts from one or more subreddits.",
    example: `type: reddit
params:
  subreddits:
    - programming
  sort: hot
  limit: 25`,
    params: {
      subreddits: {
        type: "string[]",
        required: true,
        description: "List of subreddit names (without r/).",
      },
      sort: {
        type: "string",
        default: "hot",
        constraints: "hot|new|top|rising",
        description:
          "Sort order. Aliases: popular→hot, trending→rising, best→top.",
      },
      limit: {
        type: "number",
        default: "25",
        constraints: "max 100",
        description: "Maximum number of posts to return.",
      },
      min_score: {
        type: "number",
        default: "0",
        description: "Minimum score threshold for posts.",
      },
      time: {
        type: "string",
        default: "day",
        constraints: "hour|day|week|month|year|all",
        description:
          "Time range for top posts (only used when sort=top). Aliases: 24h/1d/daily→day, 7d/weekly→week, 30d/monthly→month, 1y/yearly→year, alltime/forever→all.",
      },
    },
  },

  github: {
    summary: "Fetches GitHub trending repositories or release updates.",
    example: `type: github
params:
  mode: trending
  language: typescript
  since: daily`,
    params: {
      mode: {
        type: "string",
        default: "releases",
        constraints: "trending|releases",
        description: "Fetch mode. Alias: release→releases.",
      },
      language: {
        type: "string",
        description: "Filter trending repos by programming language.",
      },
      since: {
        type: "string",
        default: "daily",
        constraints: "daily|weekly|monthly",
        description:
          "Trending time window (trending mode only). Aliases: day/today/1d/24h→daily, week/7d→weekly, month/30d→monthly.",
      },
      limit: {
        type: "number",
        default: "10",
        constraints: "max 50",
        description: "Maximum number of items to return.",
      },
      repos: {
        type: "string[]",
        description: "List of owner/repo strings to watch for releases mode.",
      },
      token: {
        type: "string",
        description: "GitHub personal access token for releases mode.",
      },
    },
  },

  "github-releases": {
    summary: "Fetches release notes from specific GitHub repositories.",
    example: `type: github-releases
params:
  repos:
    - owner/repo`,
    params: {
      repos: {
        type: "string[]",
        required: true,
        description: "List of repositories in owner/repo format.",
      },
      token: {
        type: "string",
        description: "GitHub personal access token for authenticated requests.",
      },
      limit: {
        type: "number",
        default: "5",
        constraints: "max 30",
        description: "Maximum number of releases to return per repository.",
      },
    },
  },

  devto: {
    summary: "Fetches articles from DEV.to.",
    example: `type: devto
params:
  tags:
    - javascript
  limit: 20`,
    params: {
      tags: {
        type: "string[]",
        description:
          "Filter articles by tags. At least one of tags or username is required.",
      },
      username: {
        type: "string",
        description:
          "Fetch articles from a specific DEV.to user. At least one of tags or username is required.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 30",
        description: "Maximum number of articles to return. Shares limit with per_page (per_page takes precedence).",
      },
      per_page: {
        type: "number",
        default: "20",
        constraints: "max 30",
        description: "Items per page (takes precedence over limit when both are set).",
      },
      min_reactions: {
        type: "number",
        default: "0",
        description: "Minimum reaction count threshold for articles.",
      },
      top: {
        type: "number | string",
        default: "7",
        description:
          "Period for top articles in days, or alias: day→1, week→7, month→30, year/infinity/all→365.",
      },
    },
  },

  mastodon: {
    summary: "Fetches posts from Mastodon hashtags or accounts.",
    example: `type: mastodon
params:
  instance: mastodon.social
  hashtags:
    - technology`,
    params: {
      instance: {
        type: "string",
        default: "mastodon.social",
        description: "Mastodon instance domain.",
      },
      hashtags: {
        type: "string[]",
        description: "List of hashtags to follow (without #).",
      },
      accounts: {
        type: "string[]",
        description:
          "List of accounts to follow. Format: @user@instance or user@instance.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 40",
        description: "Maximum number of posts to return.",
      },
      min_favourites: {
        type: "number",
        default: "0",
        description: "Minimum favourites count threshold for posts.",
      },
      only_media: {
        type: "boolean",
        default: "false",
        description: "Only return posts that include media attachments.",
      },
    },
  },

  youtube: {
    summary: "Fetches videos from YouTube channels or playlists.",
    example: `type: youtube
params:
  channels:
    - UCxxxxxxxxxxxxxxxxxxxxxx`,
    params: {
      channels: {
        type: "string[]",
        description: "List of YouTube channel IDs.",
      },
      playlists: {
        type: "string[]",
        description: "List of YouTube playlist IDs.",
      },
      limit: {
        type: "number",
        default: "15",
        constraints: "max 50",
        description: "Maximum number of videos to return.",
      },
    },
  },

  arxiv: {
    summary: "Fetches papers from arXiv.",
    example: `type: arxiv
params:
  categories:
    - cs.AI
  limit: 20`,
    params: {
      categories: {
        type: "string[]",
        description: "List of arXiv category codes (e.g. cs.AI, math.CO).",
      },
      query: {
        type: "string",
        description: "Freetext search query.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 100",
        description: "Maximum number of papers to return.",
      },
    },
  },

  stackexchange: {
    summary: "Fetches questions from Stack Exchange sites.",
    example: `type: stackexchange
params:
  site: stackoverflow
  tags:
    - javascript`,
    params: {
      site: {
        type: "string",
        default: "stackoverflow",
        description: "Stack Exchange site name.",
      },
      tags: {
        type: "string[]",
        description: "Filter questions by tags.",
      },
      sort: {
        type: "string",
        default: "hot",
        constraints: "activity|votes|creation|hot|week|month",
        description:
          "Sort order. Aliases: active→activity, new/newest/recent→creation, score/popular→votes, trending→hot, weekly→week, monthly→month.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 100",
        description: "Maximum number of questions to return.",
      },
      min_score: {
        type: "number",
        default: "0",
        description: "Minimum score threshold for questions.",
      },
    },
  },

  producthunt: {
    summary: "Fetches featured products from Product Hunt.",
    example: `type: producthunt
params:
  limit: 20`,
    params: {
      limit: {
        type: "number",
        constraints: "max 50",
        description:
          "Maximum number of products to return. Omit for unlimited.",
      },
      min_upvotes: {
        type: "number",
        default: "0",
        description:
          "Minimum upvote count threshold. Requires enrich: true to be effective.",
      },
      enrich: {
        type: "boolean",
        default: "false",
        description:
          "Fetch additional details (including upvote counts) for each product.",
      },
    },
  },

  podcast: {
    summary: "Fetches episodes from podcast RSS feeds.",
    example: `type: podcast
params:
  feeds:
    - https://example.com/podcast.rss`,
    params: {
      feeds: {
        type: "string[]",
        required: true,
        description: "List of podcast RSS feed URLs.",
      },
      limit: {
        type: "number",
        default: "10",
        constraints: "max 50",
        description: "Maximum number of episodes to return.",
      },
    },
  },

  twitter: {
    summary: "Fetches tweets from Twitter/X lists or searches.",
    example: `type: twitter
params:
  searches:
    - "#typescript"
  bearer_token: YOUR_BEARER_TOKEN`,
    params: {
      lists: {
        type: "string[]",
        description: "Twitter list IDs to fetch.",
      },
      searches: {
        type: "string[]",
        description: "Search queries to fetch tweets for.",
      },
      bearer_token: {
        type: "string",
        description:
          "Twitter API bearer token. Required for real usage; returns empty without it.",
      },
    },
  },

  npm: {
    summary: "Fetches packages from the npm registry.",
    example: `type: npm
params:
  keywords:
    - typescript`,
    params: {
      keywords: {
        type: "string[]",
        description:
          "Search keywords. At least one of keywords or scope is required.",
      },
      scope: {
        type: "string",
        description:
          "npm scope to search within (without @). At least one of keywords or scope is required.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 50",
        description: "Maximum number of packages to return.",
      },
      sort: {
        type: "string",
        default: "optimal",
        constraints: "optimal|quality|popularity|maintenance",
        description:
          "Sort order. Aliases: popular→popularity, maint→maintenance, default→optimal.",
      },
    },
  },

  lemmy: {
    summary: "Fetches posts from Lemmy communities.",
    example: `type: lemmy
params:
  instance: lemmy.ml
  communities:
    - technology`,
    params: {
      instance: {
        type: "string",
        default: "lemmy.ml",
        description: "Lemmy instance domain.",
      },
      communities: {
        type: "string[]",
        description: "List of community names to fetch posts from.",
      },
      sort: {
        type: "string",
        default: "hot",
        constraints: "hot|new|top|active|mostcomments",
        description:
          "Sort order (case-insensitive). Aliases: most_comments/comments→MostComments.",
      },
      limit: {
        type: "number",
        default: "25",
        constraints: "max 50",
        description: "Maximum number of posts to return.",
      },
      min_score: {
        type: "number",
        default: "0",
        description: "Minimum score threshold for posts.",
      },
    },
  },

  wikipedia: {
    summary: "Fetches featured content from Wikipedia.",
    example: `type: wikipedia
params:
  modes:
    - most_read
  language: en`,
    params: {
      modes: {
        type: "string[]",
        constraints: "most_read|featured|on_this_day|news",
        description:
          "Content modes to fetch (preferred array form). Aliases: mostread/popular→most_read, tfa→featured, onthisday/otd→on_this_day, current_events/currentevents→news.",
      },
      mode: {
        type: "string",
        description:
          "Comma-separated content modes (deprecated alias for modes).",
      },
      language: {
        type: "string",
        default: "en",
        description: "Wikipedia language edition as an ISO 639-1 code.",
      },
      limit: {
        type: "number",
        default: "20",
        constraints: "max 50",
        description: "Maximum number of items to return.",
      },
    },
  },
};
