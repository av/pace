---
name: pace-dashboard-configure
description: >
  Generate a config.yaml for the pace personal dashboard from a user's natural-language
  description of interests. Maps topics to content adapters (RSS, Hacker News, Reddit,
  GitHub, arXiv, YouTube, Mastodon, etc.), composes transform pipelines, designs flexbox
  layouts, and optionally wires up LLM-powered summarization and ranking. Use when asked
  to configure, set up feeds for, or customize a pace dashboard.
compatibility: Requires the pace project (github.com/av/pace) checked out locally.
---

# Configure a pace dashboard

Generate a `config.yaml` for pace from a user's description of what they want to track.

## Process

1. Ask the user what topics, communities, or content types they care about.
2. Map those interests to adapters (see reference below).
3. Choose sensible params and transforms for each adapter.
4. If multiple adapters feed the same topic, create a pipeline to merge and dedupe them.
5. Design a layout that gives more space to primary interests.
6. If the user wants summaries, filtering by relevance, or interest-based ranking, add LLM config.
7. Write the final `config.yaml`.

## Adapter reference

Every adapter has an optional `refresh_interval` (minutes, default 15, minimum 1) and an optional `transforms` list applied at ingest time. The `name` field disambiguates multiple instances of the same type.

### hackernews

Hacker News stories.

```yaml
- type: hackernews
  params:
    feed: top          # top, new, best, ask, show, job
    limit: 30          # max 200
    min_score: 0       # drop items below this point threshold
```

### rss

Any RSS or Atom feed.

```yaml
- type: rss
  params:
    urls:
      - https://example.com/feed.xml
```

### reddit

Reddit subreddits.

```yaml
- type: reddit
  params:
    subreddits: [programming, selfhosted]
    sort: hot          # hot, new, top
    limit: 25          # max 100
    min_score: 0
    time: day          # hour, day, week, month, year, all (for sort: top)
```

### github

GitHub trending repos or releases from specific repos. Use `mode` to pick.

```yaml
# Trending repos
- type: github
  params:
    mode: trending
    language: typescript   # optional language filter
    since: daily           # daily, weekly, monthly
    limit: 15              # max 50

# Releases from specific repos
- name: gh-releases
  type: github
  params:
    mode: releases
    repos: [facebook/react, oven-sh/bun]
    limit: 10              # max 50
    token: ${GITHUB_TOKEN} # optional, for private repos or rate limits
```

### github-releases

Dedicated release tracker (alternative to github mode: releases).

```yaml
- type: github-releases
  params:
    repos: [denoland/deno, oven-sh/bun]
    token: ${GITHUB_TOKEN}  # optional
```

### lobsters

Lobste.rs stories.

```yaml
- type: lobsters
  params:
    feed: hottest      # hottest, newest
    limit: 25          # max 100
    min_score: 0
    tags: []           # optional tag filter
```

### mastodon

Mastodon posts by hashtag or account.

```yaml
- type: mastodon
  params:
    instance: fosstodon.org    # default: mastodon.social
    hashtags: [rust, opensource]
    accounts: []               # optional account handles
    limit: 20                  # max 40
    only_media: false
```

### youtube

YouTube channel or playlist feeds.

```yaml
- type: youtube
  params:
    channels:
      - UCXuqSBlHAE6Xw-yeJA0Tunw   # channel IDs
    playlists: []                    # playlist IDs
    limit: 15                        # max 50
```

### arxiv

Academic papers from arXiv.

```yaml
- type: arxiv
  params:
    categories: [cs.AI, cs.LG]   # arXiv category codes
    query: ""                      # optional search query
    limit: 20                      # max 100
```

### stackexchange

Questions from Stack Exchange sites.

```yaml
- type: stackexchange
  params:
    site: stackoverflow        # any SE site slug
    tags: [typescript, react]
    sort: hot                   # hot, activity, votes, creation
    limit: 20                   # max 100
    min_score: 0
```

### devto

DEV.to articles.

```yaml
- type: devto
  params:
    tags: [typescript, webdev]
    username: ""         # optional, filter by author
    limit: 15            # max 30
    min_reactions: 0
    top: 7               # period in days (1, 7, 30, 365, infinity)
```

### producthunt

Product Hunt launches.

```yaml
- type: producthunt
  params:
    limit: 20            # max 50
    min_upvotes: 0
    enrich: false        # fetch full descriptions (slower)
```

### podcast

Podcast episodes from RSS feeds.

```yaml
- type: podcast
  params:
    feeds:
      - https://feeds.simplecast.com/54nAGcIl
    limit: 10            # max 50
```

### twitter

Twitter/X lists and searches (requires authentication).

```yaml
- type: twitter
  params:
    lists: []            # list IDs
    searches: []         # search queries
```

## Transform reference

Transforms run at ingest time on adapter or pipeline results. They apply sequentially in the order listed.

```yaml
transforms:
  # Keep the N most recent items
  - type: latest
    count: 50

  # Keep items matching any keyword
  - type: filter
    keywords: [ai, rust]
    fields: [title, body]   # default: [title, body]

  # Remove items matching any keyword
  - type: exclude
    keywords: [sponsored, hiring]
    fields: [title, body]

  # Sort items
  - type: sort
    field: timestamp        # timestamp, title, source
    direction: desc         # asc, desc

  # Deduplicate items
  - type: dedupe
    strategy: url           # url, domain-normalized, title-similarity
    threshold: 0.85         # for title-similarity (0-1)
    keep: highest-score     # highest-score, earliest, latest

  # Rank by engagement + recency
  - type: time-decay
    half_life: "12h"
    engagement_weight: 0.7
    recency_weight: 0.3
    decay: exponential      # exponential, linear

  # Score by keyword relevance
  - type: keyword-score
    keywords:
      - term: "rust"
        weight: 10
      - term: "AI|machine learning"
        weight: 15
        regex: true
    min_score: 0

  # Group related items (no LLM)
  - type: cluster
    strategy: auto          # domain, keywords, source, auto

  # --- LLM transforms (require llm config) ---
  # All LLM transforms gracefully degrade (items pass through unchanged) when no LLM is configured.

  # Add LLM-generated summaries
  - type: llm-summarize

  # Keep items matching LLM-evaluated criteria
  - type: llm-filter
    criteria: "relevant to AI research"

  # Reorder by LLM-scored relevance to user interests
  - type: llm-rank

  # Group and merge related items via LLM
  - type: llm-merge
    prompt: "Group items about the same topic"
```

## Pipelines

Pipelines merge items from multiple adapters and apply cross-source transforms. Define them when the user wants a combined view.

```yaml
pipelines:
  - name: combined
    sources: [hackernews, reddit]   # adapter names
    refresh_interval: 15            # optional
    transforms:
      - type: dedupe
        strategy: url
      - type: latest
        count: 40
```

A panel references a pipeline by using the pipeline name as its `source`.

## Layout

Layout is a recursive flexbox tree. Each node is either a container (with `direction` + `children`) or a leaf panel (with `panel` + `source`).

```yaml
layout:
  direction: row           # row or column
  gap: 16                  # optional, px
  children:
    - panel: hackernews
      source: hackernews   # adapter name or pipeline name
      flex: 2              # relative size
      limit: 30            # max items to display

    - direction: column
      flex: 1
      children:
        - panel: reddit
          source: reddit
        - panel: releases
          source: gh-releases

    - panel: rss
      flex: 1
      source: rss
      limit: 20
```

The special source `all` shows items from every adapter. If layout is omitted entirely, pace renders a single "all" panel as the default.

Below 768px the layout collapses to a single column automatically.

## LLM config (optional)

```yaml
llm:
  provider: <provider>     # any provider supported by pi-ai (see pi-ai docs for full list)
  model: <model-name>
  api_key: ${LLM_API_KEY}
  interests:               # used by llm-rank
    - artificial intelligence
    - typescript
```

## Worked example

**User says:** "I want to follow AI/ML research, Rust programming news, and new open-source releases. I don't care about hiring posts."

**Resulting config.yaml:**

```yaml
adapters:
  - type: hackernews
    params:
      feed: top
      limit: 50
    refresh_interval: 10
    transforms:
      - type: filter
        keywords: [ai, llm, rust, ml, neural, transformer, open source]
        fields: [title]
      - type: exclude
        keywords: [hiring, "who is hiring"]
        fields: [title]
      - type: latest
        count: 40

  - type: arxiv
    params:
      categories: [cs.AI, cs.LG, cs.CL]
      limit: 20
    refresh_interval: 60
    transforms:
      - type: latest
        count: 20

  - type: rss
    params:
      urls:
        - https://blog.rust-lang.org/feed.xml
        - https://this-week-in-rust.org/atom.xml
    refresh_interval: 30

  - type: lobsters
    params:
      feed: hottest
      limit: 25
      tags: [rust]
    refresh_interval: 15

  - name: gh-releases
    type: github
    params:
      mode: releases
      repos: [rust-lang/rust, huggingface/transformers, pytorch/pytorch]
      limit: 10
    refresh_interval: 60

pipelines:
  - name: ai-combined
    sources: [hackernews, arxiv]
    transforms:
      - type: dedupe
        strategy: title-similarity
        threshold: 0.8
      - type: latest
        count: 40

  - name: rust-combined
    sources: [rss, lobsters]
    transforms:
      - type: dedupe
        strategy: url
      - type: latest
        count: 25

layout:
  direction: row
  children:
    - panel: ai
      source: ai-combined
      flex: 2
      limit: 40

    - direction: column
      flex: 1
      children:
        - panel: rust
          source: rust-combined
          limit: 25
        - panel: releases
          source: gh-releases
          limit: 10
```
