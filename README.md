# pace

Self-hostable personal dashboard that aggregates content from across the web. Pluggable adapters, ingest-time transforms, optional LLM-powered summaries and ranking.

## Quick start

```bash
docker run -d -p 3000:3000 -v pace-data:/app/data ghcr.io/av/pace:latest
```

Open http://localhost:3000 — the default config ships with Hacker News, Lobsters, GitHub trending/releases, engineering blogs, and DEV.to.

### Custom config

```bash
# grab the example and edit it
curl -O https://raw.githubusercontent.com/av/pace/main/config.example.yaml
mv config.example.yaml config.yaml
# edit config.yaml with your feeds

docker run -d -p 3000:3000 \
  -v ./config.yaml:/app/config.yaml:ro \
  -v pace-data:/app/data \
  ghcr.io/av/pace:latest
```

### From source

```bash
git clone https://github.com/av/pace.git && cd pace
bun install
bun run dev
```

## Adapters

| Type | What it fetches | Key params |
|------|----------------|------------|
| `hackernews` | HN stories | `feed` (top/new/best/ask/show/job), `limit`, `min_score` |
| `lobsters` | Lobste.rs stories | `feed` (hottest/newest), `limit`, `min_score`, `tags` |
| `rss` | Any RSS/Atom feed | `urls` |
| `reddit` | Subreddit posts | `subreddits`, `sort`, `limit`, `min_score` |
| `github` | Trending repos or releases | `mode` (trending/releases), `repos`, `language`, `since` |
| `github-releases` | Release tracker | `repos`, `token` |
| `devto` | DEV.to articles | `tags`, `top`, `limit`, `min_reactions` |
| `youtube` | Channel/playlist feeds | `channels`, `playlists`, `limit` |
| `arxiv` | Academic papers | `categories`, `query`, `limit` |
| `stackexchange` | SE questions | `site`, `tags`, `sort`, `min_score` |
| `mastodon` | Mastodon posts | `instance`, `hashtags`, `accounts`, `limit` |
| `producthunt` | Product launches | `limit`, `min_upvotes`, `enrich` |
| `podcast` | Podcast episodes | `feeds`, `limit` |
| `twitter` | Lists and searches | `lists`, `searches` |

Each adapter has a `refresh_interval` in minutes (default: 15).

## Transforms

Applied at ingest time on adapters or pipelines:

`latest` `filter` `exclude` `sort` `dedupe` `time-decay` `keyword-score` `cluster` `llm-summarize` `llm-filter` `llm-rank` `llm-merge`

See `config.example.yaml` for full options.

## Layout

Recursive flexbox tree in YAML. Panels reference adapter or pipeline names as sources.

```yaml
layout:
  direction: row
  children:
    - panel: news
      source: hackernews
      flex: 2
    - direction: column
      flex: 1
      children:
        - panel: blogs
          source: rss
        - panel: releases
          source: gh-releases
```

Collapses to single column below 768px.

## LLM (optional)

Supports any provider via [pi-ai](https://github.com/badlogic/pi-mono). LLM transforms gracefully degrade when unconfigured.

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}
  interests: [systems programming, web development]
```

## Themed configs

Pre-built configs for common use cases:

| File | Focus |
|------|-------|
| `config.example.yaml` | General SWE (HN, Lobsters, GitHub, blogs, DEV.to) |
| `config.tech-news.yaml` | Tech news aggregation |
| `config.ml-ai.yaml` | AI/ML research |
| `config.product-launches.yaml` | Product launches |
| `config.release-tracker.yaml` | Software releases |
| `config.academic-papers.yaml` | Academic papers |
| `config.video-podcast.yaml` | Video and podcast content |

## Tech stack

Bun + Hono + SQLite + JSX server rendering. No client-side JavaScript.

## License

MIT
