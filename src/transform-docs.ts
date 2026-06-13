import type { TransformType } from "./transform-schema";

export type TransformParamDoc = {
  type: string;
  required?: true;
  default?: string;
  constraints?: string;
  description: string;
};

export type TransformDoc = {
  summary: string;
  example: string;
  params: Record<string, TransformParamDoc>;
  note?: string;
};

export const TRANSFORM_DOCS: Record<TransformType, TransformDoc> = {
  latest: {
    summary: "Keep only the N most recent items.",
    example: `type: latest
count: 20`,
    params: {
      count: {
        type: "positive integer",
        required: true,
        description: "Maximum number of items to retain (kept in original order).",
      },
    },
  },

  filter: {
    summary: "Keep only items that match at least one keyword.",
    example: `type: filter
keywords:
  - AI
  - machine learning
fields:
  - title
  - body`,
    params: {
      keywords: {
        type: "string[]",
        required: true,
        description: "List of keywords (case-insensitive substring match). Items matching any keyword are kept.",
      },
      fields: {
        type: "enum[]",
        default: "all fields (title, body, source)",
        constraints: "title | body | source",
        description: "Which item fields to search. Defaults to all three when omitted.",
      },
    },
  },

  exclude: {
    summary: "Remove items that match at least one keyword.",
    example: `type: exclude
keywords:
  - sponsored
  - advertisement
fields:
  - title`,
    params: {
      keywords: {
        type: "string[]",
        required: true,
        description: "List of keywords (case-insensitive substring match). Items matching any keyword are removed.",
      },
      fields: {
        type: "enum[]",
        default: "all fields (title, body, source)",
        constraints: "title | body | source",
        description: "Which item fields to search. Defaults to all three when omitted.",
      },
    },
  },

  sort: {
    summary: "Sort items by a field.",
    example: `type: sort
field: timestamp
direction: desc`,
    params: {
      field: {
        type: "enum",
        default: "timestamp",
        constraints: "timestamp | title | source",
        description: "The item field to sort by.",
      },
      direction: {
        type: "enum",
        default: "desc",
        constraints: "asc | desc",
        description: "Sort direction: descending (newest/Z-A first) or ascending (oldest/A-Z first).",
      },
    },
  },

  dedupe: {
    summary: "Remove duplicate items using the chosen strategy.",
    example: `type: dedupe
strategy: title-similarity
threshold: 0.85
keep: highest-score`,
    params: {
      strategy: {
        type: "enum",
        default: "url",
        constraints: "url | domain-normalized | title-similarity",
        description:
          "Deduplication method. `url` removes exact URL duplicates. `domain-normalized` collapses items from the same domain. `title-similarity` uses fuzzy title matching.",
      },
      threshold: {
        type: "float",
        default: "0.85",
        constraints: "0..1, only valid for strategy: title-similarity",
        description: "Similarity threshold above which two items are considered duplicates.",
      },
      keep: {
        type: "enum",
        default: "highest-score",
        constraints: "highest-score | earliest | latest, only valid for strategy: domain-normalized or title-similarity",
        description: "Which item to keep when duplicates are found.",
      },
      log: {
        type: "boolean",
        description: "When true, emit a log entry for each removed duplicate.",
      },
    },
  },

  "keyword-score": {
    summary: "Score items by keyword matches; optionally filter below a minimum score.",
    example: `type: keyword-score
keywords:
  - term: AI
    weight: 2
  - term: spam
    weight: -1
min_score: 0
annotate: true`,
    params: {
      keywords: {
        type: "{ term: string; weight: number; regex?: boolean }[]",
        required: true,
        description:
          "Scoring rules. Each entry has a `term` (substring or regex pattern), a numeric `weight` (positive boosts, negative penalises), and an optional `regex` flag.",
      },
      min_score: {
        type: "number",
        description: "Items with a final score below this value are removed. Omit to keep all items regardless of score.",
      },
      annotate: {
        type: "boolean",
        description: "When true, attach the computed score to each item for inspection.",
      },
    },
  },

  "time-decay": {
    summary: "Down-score older items using time-based decay, optionally blended with engagement.",
    example: `type: time-decay
half_life: 24h
decay: exponential
recency_weight: 1
engagement_weight: 0.5
min_score: 0.1
annotate: true`,
    params: {
      half_life: {
        type: "duration string",
        description:
          "Time after which an item's recency contribution is halved (e.g. `12h`, `2d`). Uses a sensible default when omitted.",
      },
      engagement_weight: {
        type: "float",
        description: "Weight applied to the engagement component of the score.",
      },
      recency_weight: {
        type: "float",
        description: "Weight applied to the recency component of the score.",
      },
      decay: {
        type: "enum",
        constraints: "exponential | linear",
        description: "Decay curve shape. `exponential` drops off quickly; `linear` decays at a constant rate.",
      },
      annotate: {
        type: "boolean",
        description: "When true, attach the computed decay score to each item.",
      },
      min_score: {
        type: "number",
        description: "Items with a decay score below this value are removed.",
      },
    },
  },

  cluster: {
    summary: "Group items into clusters and annotate or filter by cluster membership.",
    example: `type: cluster
strategy: keywords
min_cluster_size: 2
max_clusters: 10
similarity_threshold: 0.6
annotate: true`,
    params: {
      strategy: {
        type: "enum",
        constraints: "domain | keywords | source | auto",
        description:
          "Clustering method. `domain` groups by URL domain, `keywords` by shared terms, `source` by feed source, `auto` selects the best strategy automatically.",
      },
      min_cluster_size: {
        type: "positive integer",
        description: "Minimum number of items required to form a cluster.",
      },
      max_clusters: {
        type: "positive integer",
        description: "Upper bound on the number of clusters produced.",
      },
      similarity_threshold: {
        type: "float",
        constraints: "0..1",
        description: "Minimum similarity score for two items to be placed in the same cluster.",
      },
      annotate: {
        type: "boolean",
        description: "When true, attach cluster metadata to each item.",
      },
    },
  },

  "llm-summarize": {
    summary: "Summarize each item's content using an LLM.",
    example: `type: llm-summarize
fetch_content: true`,
    params: {
      fetch_content: {
        type: "boolean",
        default: "false",
        description:
          "When true, fetch each item's URL before summarizing and pass the extracted page text to the LLM as additional context. Already-summarized items are skipped. Falls back silently per-item on fetch failure.",
      },
    },
    note: "Degrades to pass-through without llm config",
  },

  "llm-filter": {
    summary: "Filter items using natural-language criteria evaluated by an LLM.",
    example: `type: llm-filter
criteria: Keep only items about climate policy or renewable energy.`,
    params: {
      criteria: {
        type: "string",
        required: true,
        description: "Natural-language description of which items to keep. The LLM evaluates each item against this criteria.",
      },
    },
    note: "Degrades to pass-through without llm config",
  },

  "llm-rank": {
    summary: "Rank items by relevance to a set of interests using an LLM.",
    example: `type: llm-rank
interests:
  - open source software
  - distributed systems`,
    params: {
      interests: {
        type: "string[]",
        description:
          "Topics or themes to rank items against. Falls back to the `llm.interests` field in the top-level config when omitted.",
      },
    },
    note: "Degrades to pass-through without llm config",
  },

  "llm-merge": {
    summary: "Merge and synthesise a batch of items into a single summary item using an LLM.",
    example: `type: llm-merge
prompt: Summarise these news items into a concise briefing.`,
    params: {
      prompt: {
        type: "string",
        description: "Optional instruction passed to the LLM describing how to merge the items.",
      },
    },
    note: "Degrades to pass-through without llm config",
  },
};
