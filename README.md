# pace

**Self-hosted news aggregator and personal content dashboard.**

![Pace — self-hosted news aggregator dashboard showing Hacker News, Reddit, GitHub, RSS feeds, and more in a configurable layout](./assets/splash.jpg)

Aggregate Hacker News, Reddit, RSS, GitHub, Mastodon, YouTube, arXiv, and 10 more sources into a single dashboard you own. Filter, deduplicate, score, and optionally use an LLM to summarize and rank what matters to you. Everything runs in a single Docker container with zero client-side JavaScript.

- **17 built-in sources** — Hacker News, Reddit, RSS/Atom, GitHub, Mastodon, YouTube, arXiv, npm, Wikipedia, Lemmy, and more
- **Configurable in YAML** — adapters, transforms, layout, and LLM settings in one file
- **Self-hosted in one command** — `docker run` and you're done, SQLite for persistence
- **Optional AI-powered filtering** — LLM summarization, ranking, and filtering via any OpenAI/Anthropic/Google/Groq provider
- **No client-side JavaScript** — server-rendered HTML, fast on any device

## Quick start

```bash
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest
```

Open http://localhost:7453 — the default config ships with Hacker News, Lobsters, GitHub trending/releases, engineering blogs, and DEV.to.

### With a preset

Presets are bundled configs for common setups. Use `--preset` (or `-P`) to start with one:

```bash
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest --preset tech-news
```

Available presets:

| Preset | Focus |
|--------|-------|
| `tech-news` | Tech news: HN + Lobsters frontpage, Lemmy communities, news/blogs, releases |
| `ml-ai` | AI and machine learning: arXiv papers, local-LLM community, releases, curated blogs |
| `daily-brief` | Morning briefing: world headlines, Wikipedia in-the-news/most-read, big HN stories |
| `product-launches` | Product launches: Product Hunt, Show HN, trending repos, fresh npm packages |
| `release-tracker` | Software release tracking |
| `academic-papers` | Academic papers: arXiv, CS theory Q&A, science journalism |
| `video-podcast` | Video and podcast content |

Or list them locally: `pace --list-presets`

### Custom config

```bash
curl -O https://raw.githubusercontent.com/av/pace/main/config.example.yaml
mv config.example.yaml config.yaml
# edit config.yaml
docker run -d -p 7453:7453 \
  -v pace-data:/app/data \
  -v ./config.yaml:/app/config.yaml:ro \
  ghcr.io/av/pace:latest
```

### From source

Requires Bun v1.3+.

```bash
git clone https://github.com/av/pace.git && cd pace
bun install
bun run dev
```

## Content adapters

Pace ships with 17 adapters that pull content from public APIs. Each adapter has a configurable `refresh_interval` (in minutes, default: 15).

| Adapter | Source |
|---------|--------|
| `hackernews` | Hacker News (top, new, best, ask, show) |
| `reddit` | Reddit subreddits |
| `rss` | Any RSS feed |
| `atom` | Any Atom feed |
| `github` | GitHub trending repos + release tracking |
| `lobsters` | Lobsters (hottest, newest) |
| `youtube` | YouTube channels |
| `arxiv` | arXiv papers by category |
| `mastodon` | Mastodon hashtags/timelines |
| `npm` | npm package updates |
| `wikipedia` | Wikipedia featured/most-read/on-this-day |
| `lemmy` | Lemmy communities |
| `devto` | DEV.to articles |
| `stackexchange` | Stack Exchange sites |
| `producthunt` | Product Hunt |
| `podcast` | Podcast RSS feeds |
| `twitter` | Twitter/X |

```bash
pace adapters list            # list all adapter types
pace adapters explain <type>  # show params and example
```

## Transforms

Transforms process content after fetching — filter, deduplicate, rank, or enrich items before they reach the dashboard.

| Transform | What it does |
|-----------|-------------|
| `latest` | Keep the N most recent items |
| `filter` | Include items matching keywords |
| `exclude` | Remove items matching keywords |
| `sort` | Sort by field (score, date, title) |
| `dedupe` | Deduplicate by URL, domain, or title similarity |
| `time-decay` | Blend engagement with recency using configurable half-life |
| `keyword-score` | Score items by weighted keyword/regex matches |
| `cluster` | Group related stories across sources |
| `llm-summarize` | Summarize items with an LLM (optionally fetches full page content) |
| `llm-filter` | Keep only items matching interests, scored by LLM |
| `llm-rank` | Rank items 0–10 by relevance to your interests |
| `llm-merge` | Merge and deduplicate using LLM understanding |

```bash
pace transforms list            # list all transform types
pace transforms explain <type>  # show params and example
```

## Pipelines

Pipelines merge items from multiple adapters, then apply transforms to the combined feed. Useful for cross-source deduplication and unified ranking.

```yaml
pipelines:
  - name: curated-feed
    sources: [hackernews, lobsters, rss]
    transforms:
      - type: dedupe
        strategy: url
      - type: llm-rank
        interests: [distributed systems, security, open source]
      - type: llm-summarize
        fetch_content: true
```

## Layout

Arrange panels in a recursive flexbox tree. Each node is either a container (with direction + children) or a leaf panel (with a source).

```yaml
layout:
  direction: row
  children:
    - panel: main-feed
      source: curated-feed
      flex: 2
    - direction: column
      flex: 1
      children:
        - panel: releases
          source: gh-releases
        - panel: papers
          source: arxiv
```

Responsive — collapses to a single column on mobile (below 768px).

## LLM integration (optional)

Connect any LLM provider via [pi-ai](https://github.com/badlogic/pi-mono) to power the `llm-*` transforms. Works with OpenAI, Anthropic, Google, Groq, Mistral, and any OpenAI-compatible endpoint. Gracefully degrades when unconfigured.

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}

  # or use a local model via any OpenAI-compatible server:
  # provider: openai
  # model: llama3
  # base_url: http://localhost:11434/v1
```

Define your interests once; all `llm-rank` and `llm-filter` transforms use them by default:

```yaml
llm:
  interests: [systems programming, self-hosting, security]
```

## For agents

Pace ships with built-in agent skills for setup and configuration:

```bash
pace skill                          # list available skills
pace skill pace-dashboard-setup     # deployment guide
pace skill pace-dashboard-configure # full configuration reference
```

Also available from Docker:

```bash
docker run --rm ghcr.io/av/pace pace skill
```

## Tech stack

Bun + Hono + SQLite + JSX server rendering. No client-side JavaScript.

## License

MIT
