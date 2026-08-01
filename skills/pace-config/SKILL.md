---
name: pace-config
description: >
  Generate a config.yaml for the pace personal dashboard from a user's natural-language
  description of interests. Maps topics to content adapters (RSS, Hacker News, Reddit,
  GitHub, arXiv, YouTube, Mastodon, etc.), composes transform pipelines, designs flexbox
  layouts, and optionally wires up LLM-powered summarization and ranking. Use when asked
  to configure, set up feeds for, or customize a pace dashboard.
---

# Configure a pace dashboard

Generate a `config.yaml` for pace from a user's description of what they want to track.

> **Source of truth:** The snippets in this skill are illustrative and may lag behind the
> running version. Always confirm current shapes with:
> ```
> pace adapters list
> pace adapters explain <type>
> pace transforms list
> pace transforms explain <type>
> pace presets list
> ```

## Process

0. Check whether a bundled preset already covers the user's request -- see "Start from a preset" below.
1. Ask the user what topics, communities, or content types they care about.
2. Map those interests to adapters (see reference below).
3. Choose sensible params and transforms for each adapter.
4. If multiple adapters feed the same topic, create a pipeline to merge and dedupe them.
5. Design a layout that gives more space to primary interests.
6. If the user wants summaries, filtering by relevance, or interest-based ranking, add LLM config.
7. Write the final `config.yaml`.
8. Run `pace config check config.yaml` to validate before handing off to the user.

## Start from a preset

Before building from scratch, check whether a bundled preset already matches the user's theme:

```bash
pace presets list
# tech-news        -- Tech news: HN + Lobsters frontpage, Lemmy communities, news/blogs, releases
# ml-ai            -- AI and machine learning: arXiv papers, local-LLM community, releases, curated blogs
# daily-brief      -- Morning briefing: world headlines, Wikipedia in-the-news/most-read, big HN stories
# product-launches -- Product launches: Product Hunt, Show HN, trending repos, fresh npm packages
# release-tracker  -- Software release tracking
# academic-papers  -- Academic papers: arXiv, CS theory Q&A, science journalism
# video-podcast    -- Video and podcast content
```

To use a preset as the starting point:

```bash
# Bun:
pace --preset tech-news

# Docker:
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest --preset tech-news
```

**Guidance:** prefer preset + targeted edits when the user's ask matches a theme. Only build
from scratch when no preset is close. When using a preset, copy it to `config.yaml`, make the
minimal changes the user requested, and validate with `pace config check`.

## Modifying an existing config

When the user already has a `config.yaml`:

**Example -- "drop YouTube, show only LLM news from HN":**

```yaml
# BEFORE
adapters:
  - type: hackernews
    params:
      feed: top
      limit: 50
  - type: youtube
    params:
      channels: [UCXuqSBlHAE6Xw-yeJA0Tunw]
      limit: 15

# AFTER -- youtube adapter removed; hackernews gains an llm-filter transform
adapters:
  - type: hackernews
    params:
      feed: top
      limit: 50
    transforms:
      - type: llm-filter
        criteria: "relevant to LLM or AI research"
```

1. Read the current file before making any edits.
2. Make the minimal changes required -- remove/replace adapters the user no longer wants, add
   new ones, adjust params and transforms.
3. Validate the edited config:
   ```bash
   pace config check config.yaml
   ```
   This catches schema errors and unknown adapter types without starting the server -- fast
   iteration loop.
4. **Restart required:** pace reads `config.yaml` once at startup; it does not watch the file
   for changes. After writing the new config, the server must be restarted to pick it up:
   ```bash
   # Bun dev:
   # Ctrl-C, then: bun run dev

   # Docker Compose:
   docker compose restart

   # Docker direct:
   docker stop <container> && docker run ...
   ```
5. **Immediate panel refresh** (after restart): trigger a panel to fetch content right away
   without waiting for `refresh_interval`:
   ```bash
   curl -X POST http://localhost:7453/refresh/<panel-id>
   # e.g.: curl -X POST http://localhost:7453/refresh/hackernews
   ```

## Adapter reference

Every adapter has an optional `refresh_interval` (minutes, default 15, minimum 1) and an optional `transforms` list applied at ingest time. The `name` field disambiguates multiple instances of the same type.

### hackernews

Hacker News stories.

```yaml
# Authoritative shape: pace adapters explain hackernews
- type: hackernews
  params:
    type: top          # highest-priority alias (type > feed > stories); top, new, best, ask, show, job
    feed: top          # mid-priority alias; same values. Aliases: newest→new, front→top, askhn→ask, showhn→show, jobs→job
    stories: top       # lowest-priority alias for feed
    limit: 30          # max 200
    min_score: 0       # drop items below this point threshold
```

### rss

Any RSS or Atom feed.

```yaml
# Authoritative shape: pace adapters explain rss
- type: rss
  params:
    urls:
      - https://example.com/feed.xml
    limit: 50          # max 200; omit for unlimited (per feed)
```

### reddit

Reddit subreddits.

> **Caveat:** Reddit's public unauthenticated `.json` API often returns **HTTP 403** upstream, so this adapter may not work without credentials. Bundled presets omit Reddit for this reason. For community discussions that work out of the box, prefer **`lemmy`** (used in `tech-news` and `ml-ai` presets).

```yaml
# Authoritative shape: pace adapters explain reddit
- type: reddit
  params:
    subreddits: [programming, selfhosted]
    sort: hot          # hot, new, top, rising (aliases: popular→hot, trending→rising, best→top)
    limit: 25          # max 100
    min_score: 0
    time: day          # hour, day, week, month, year, all (for sort: top)
```

### github

GitHub trending repos or releases from specific repos. Use `mode` to pick (default: `releases`).

```yaml
# Authoritative shape: pace adapters explain github
# Trending repos
- type: github
  params:
    mode: trending
    language: typescript   # optional language filter
    since: daily           # daily, weekly, monthly
    limit: 15              # default 10, max 50

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
# Authoritative shape: pace adapters explain github-releases
- type: github-releases
  params:
    repos: [denoland/deno, oven-sh/bun]
    limit: 5                 # optional, default 5, max 30 (per_page per repo)
    token: ${GITHUB_TOKEN}  # optional
```

### lobsters

Lobste.rs stories.

```yaml
# Authoritative shape: pace adapters explain lobsters
- type: lobsters
  params:
    feed: hottest      # hottest, newest, active (aliases: hot/front→hottest, new/recent→newest)
    limit: 25          # max 100
    min_score: 0
    tags: []           # optional tag filter
```

### mastodon

Mastodon posts by hashtag or account.

```yaml
# Authoritative shape: pace adapters explain mastodon
- type: mastodon
  params:
    instance: fosstodon.org    # default: mastodon.social
    hashtags: [rust, opensource]
    accounts: []               # optional account handles (@user@instance or user@instance)
    limit: 20                  # max 40
    min_favourites: 0          # minimum favourites count threshold
    only_media: false
```

### youtube

YouTube channel or playlist feeds.

```yaml
# Authoritative shape: pace adapters explain youtube
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
# Authoritative shape: pace adapters explain arxiv
- type: arxiv
  params:
    categories: [cs.AI, cs.LG]   # arXiv category codes
    query: ""                      # optional search query
    limit: 20                      # max 100
```

### stackexchange

Questions from Stack Exchange sites.

```yaml
# Authoritative shape: pace adapters explain stackexchange
- type: stackexchange
  params:
    site: stackoverflow        # any SE site slug
    tags: [typescript, react]
    sort: hot                   # hot, activity, votes, creation, week, month
                                # (aliases: active→activity, new/newest/recent→creation,
                                #  score/popular→votes, trending→hot, weekly→week, monthly→month)
    limit: 20                   # max 100
    min_score: 0
```

### devto

DEV.to articles.

```yaml
# Authoritative shape: pace adapters explain devto
- type: devto
  params:
    tags: [typescript, webdev]   # at least one of tags or username is required
    username: ""         # fetch articles from a specific DEV.to user
    limit: 15            # default 20, max 30
    per_page: 20         # items per page; takes precedence over limit when both are set (max 30)
    min_reactions: 0
    top: 7               # period in days (1, 7, 30, 365; aliases: day→1, week→7, month→30, year/infinity/all→365)
```

### producthunt

Product Hunt launches.

```yaml
# Authoritative shape: pace adapters explain producthunt
- type: producthunt
  params:
    limit: 20            # max 50; omit for unlimited
    min_upvotes: 0       # only effective with enrich: true (upvote counts need enrichment)
    enrich: false        # fetch full details incl. upvote counts (slower)
```

### podcast

Podcast episodes from RSS feeds.

```yaml
# Authoritative shape: pace adapters explain podcast
- type: podcast
  params:
    feeds:
      - https://feeds.simplecast.com/54nAGcIl
    limit: 10            # max 50
```

### twitter

Twitter/X lists and searches (requires authentication).

> **Caveat:** Without `params.bearer_token`, this adapter **always returns an empty list** — no error, just no items. A Twitter API v2 bearer token is required for real usage. Run `pace adapters explain twitter` for the current param shape.

```yaml
# Authoritative shape: pace adapters explain twitter
- type: twitter
  params:
    lists: []            # list IDs
    searches: []         # search queries
    bearer_token: ${TWITTER_BEARER_TOKEN}  # required; returns [] without it
```

### npm

npm registry package search.

```yaml
# Authoritative shape: pace adapters explain npm
- type: npm
  params:
    keywords: [typescript, cli]   # at least one of keywords or scope is required
    scope: "my-org"               # optional npm scope (without @)
    limit: 20                     # max 50
    sort: optimal                 # optimal, quality, popularity, maintenance
                                  # (aliases: popular→popularity, maint→maintenance, default→optimal)
```

### lemmy

Lemmy federated community posts.

```yaml
# Authoritative shape: pace adapters explain lemmy
- type: lemmy
  params:
    instance: lemmy.ml               # Lemmy instance domain
    communities: [technology, linux] # list of community names
    sort: hot                        # hot, new, top, active, mostcomments
                                     # (aliases: most_comments/comments→MostComments)
    limit: 25                        # max 50
    min_score: 0
```

### wikipedia

Wikipedia featured content.

```yaml
# Authoritative shape: pace adapters explain wikipedia
- type: wikipedia
  params:
    modes:                 # preferred array form
      - most_read          # most_read, featured, on_this_day, news
      - on_this_day        # aliases: mostread/popular→most_read, tfa→featured,
                           #          onthisday/otd→on_this_day, current_events/currentevents→news
    language: en           # ISO 639-1 language code
    limit: 20              # max 50
```

### bookmarks

Curated bookmark links defined directly in config (no network fetch).

```yaml
# Authoritative shape: pace adapters explain bookmarks
- type: bookmarks
  params:
    items:
      - title: "Linear"
        url: "https://linear.app"
        description: "Issue tracker"
        tags: ["work", "daily"]
      - title: "Figma"
        url: "https://figma.com"
        tags: ["design"]
```

### counter

Fetches a JSON endpoint and extracts a numeric value for stat-card display. Use with `display: counter` on panels.

```yaml
# Authoritative shape: pace adapters explain counter
- type: counter
  params:
    url: https://api.github.com/repos/oven-sh/bun
    json_path: stargazers_count
    label: "Bun Stars"
    # Optional:
    # unit: "%"
    # compare_url: https://metrics.internal/api/v1/error_rate?period=previous
    # compare_path: data.current
    # headers:
    #   Authorization: "Bearer ${METRICS_TOKEN}"
```

## Transform reference

Transforms run at ingest time on adapter or pipeline results. They apply sequentially in the order listed.

```yaml
# Authoritative shape: pace transforms explain latest
transforms:
  - type: latest
    count: 50
    per_source: 10          # optional cap per item source, so one source can't fill the result

# Authoritative shape: pace transforms explain filter
  # Keep items matching any keyword
  - type: filter
    keywords: [ai, rust]
    fields: [title, body]   # default: all fields (title, body, source)

# Authoritative shape: pace transforms explain exclude
  # Remove items matching any keyword
  - type: exclude
    keywords: [sponsored, hiring]
    fields: [title, body]   # default: all fields (title, body, source)

# Authoritative shape: pace transforms explain sort
  # Sort items
  - type: sort
    field: timestamp        # timestamp, title, source
    direction: desc         # asc, desc

# Authoritative shape: pace transforms explain dedupe
  - type: dedupe
    strategy: url           # url, domain-normalized, title-similarity
    threshold: 0.85         # for title-similarity (0-1)
    keep: highest-score     # highest-score, earliest, latest
    log: false              # optional; log each removed duplicate

# Authoritative shape: pace transforms explain time-decay
  # Rank by engagement + recency
  - type: time-decay
    half_life: "12h"
    engagement_weight: 0.7
    recency_weight: 0.3
    decay: exponential      # exponential, linear
    min_score: 0.1
    annotate: false

# Authoritative shape: pace transforms explain keyword-score
  # Score by keyword relevance
  - type: keyword-score
    keywords:
      - term: "rust"
        weight: 10
      - term: "AI|machine learning"
        weight: 15
        regex: true
    min_score: 0
    annotate: false

# Authoritative shape: pace transforms explain cluster
  - type: cluster
    strategy: auto          # domain, keywords, source, auto
    min_cluster_size: 2
    max_clusters: 10
    similarity_threshold: 0.6
    annotate: false

  # --- LLM transforms (require llm config) ---
  # All LLM transforms gracefully degrade (items pass through unchanged) when no LLM is configured.

# Authoritative shape: pace transforms explain llm-summarize
  - type: llm-summarize
    fetch_content: false    # optional; fetch each item's URL and summarize the page text
                            # (fetch_content_allow_private: true permits loopback/private
                            #  targets -- local development only)

# Authoritative shape: pace transforms explain llm-filter
  - type: llm-filter
    criteria: "relevant to AI research"

# Authoritative shape: pace transforms explain llm-rank
  - type: llm-rank
    interests:             # optional; falls back to llm.interests in top-level config
      - open source software

# Authoritative shape: pace transforms explain llm-merge
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

Layout is a recursive flexbox tree. Each node is one of:

- **Container** (`direction` + `children`): row or column flex wrapper.
- **Panel** (`panel` + `source`): content feed panel. Optional `display: counter` renders stat cards instead of a content list.
- **Image widget** (`image`): static image from a URL.
- **Text widget** (`text`): static text block (plain, markdown, or html).
- **Iframe widget** (`iframe`): embedded external page in a sandboxed iframe.

Panel fields: `panel` (display name, must be unique), `source` (required), and optional `flex`, `limit`, `display`, `id`. `source` is an adapter name, a pipeline name, or a **list of names** — a multi-source panel merges items from every listed source into one feed. `id` pins the panel's storage/refresh identifier (used in `POST /refresh/<id>`); when omitted it is derived from the panel definition.

```yaml
layout:
  direction: row           # row or column
  gap: 16px                # optional CSS gap between children
  children:
    - panel: hackernews
      source: hackernews   # adapter name or pipeline name
      flex: 2              # relative size
      limit: 30            # max items to display

    - panel: firehose
      source: [lobsters, rss]   # multi-source panel: merged feed from several sources

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

### Widget nodes

Widgets are layout leaves that display static content (no adapter source needed).

```yaml
# Image widget
- image: https://example.com/banner.png
  alt: "Dashboard banner"          # optional alt text
  object_fit: cover                # cover, contain, fill, none (default: contain)
  max_height: 200px                # optional CSS max-height
  link: https://example.com        # optional clickable link (https or http://localhost only)
  flex: 1                          # optional relative size

# Text widget
- text: "Welcome to the dashboard"
  format: markdown                 # plain (default), markdown, html
  title: "Greeting"                # optional header
  flex: 1

# Iframe widget
- iframe: https://grafana.example.com/d/abc
  title: "Grafana"                 # optional header
  height: 400px                    # CSS length; takes priority over aspect_ratio
  aspect_ratio: 16/9               # fallback when height is not set (default: 16/9)
  sandbox: "allow-scripts allow-same-origin"  # optional sandbox tokens
  allow: "fullscreen"              # optional Permissions-Policy directives
  flex: 1
```

### Counter display mode

Panels using the counter adapter should set `display: counter` to render stat cards:

```yaml
- panel: metrics
  source: my-counter
  display: counter                 # renders stat cards instead of content list
```

The special source `all` shows items from every adapter. If layout is omitted entirely, pace renders a single "all" panel as the default.

Below 768px the layout collapses to a single column automatically.

## LLM config (optional)

LLM transforms (`llm-summarize`, `llm-filter`, `llm-rank`, `llm-merge`) pass items through **unchanged** when the `llm` block is absent or misconfigured -- they never error out.

```yaml
# Two concrete provider examples:

# Anthropic (Claude)
llm:
  provider: anthropic
  model: claude-sonnet-4-6
  api_key: ${LLM_API_KEY}
  interests:               # used by llm-rank
    - artificial intelligence
    - typescript

# OpenAI
llm:
  provider: openai
  model: gpt-4o
  api_key: ${LLM_API_KEY}
  interests:
    - artificial intelligence
    - typescript
```

**Wiring the API key:**

```bash
# Bun dev:
LLM_API_KEY=sk-... bun run dev

# Docker:
docker run -d -p 7453:7453 \
  -e LLM_API_KEY=sk-... \
  -v ./config.yaml:/app/config.yaml:ro \
  -v pace-data:/app/data \
  ghcr.io/av/pace:latest
```

The `provider` value is passed to [pi-ai](https://github.com/badlogic/pi-mono); supported providers include anthropic, openai, google, groq, mistral, and others -- see pi-ai docs for the full list.

Optional: `timeout_seconds` caps each LLM completion (default 120). Raise it for slow local models (e.g. Ollama on modest hardware); a completion that exceeds it is abandoned and the items pass through unchanged.

```yaml
llm:
  provider: ollama
  model: llama3.1
  api_key: unused
  base_url: http://localhost:11434/v1
  timeout_seconds: 300
```

## Server config (optional)

An optional top-level `server` block controls server behavior (unknown fields are a validation error):

```yaml
server:
  base_path: /pace     # serve under a URL prefix behind a reverse proxy (default: none)
  retention_days: 30   # days to keep fetched items in SQLite; 0 disables pruning (default: 30)
```

- `base_path` (string): for deployments under a subpath like `https://example.com/pace/`. Normalized on load (leading `/` added, trailing `/` stripped). The server responds at both the prefix and the root, so it works whether or not the proxy strips the prefix.
- `retention_days` (non-negative integer): items last fetched more than this many days ago are pruned at startup and every 24 hours. `0` keeps everything.

Port and config path are NOT config fields: use `--port`/`$PORT` and `--config`/`--preset`/`$PACE_CONFIG`.

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
