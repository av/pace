<p align="center">
  <a href="https://www.youtube.com/watch?v=UElmyC06ryM"><strong>▶ Watch the 2-minute demo on YouTube</strong></a>
</p>

<a href="https://www.youtube.com/watch?v=UElmyC06ryM" title="Watch the pace demo on YouTube">
  <img src="https://img.youtube.com/vi/UElmyC06ryM/maxresdefault.jpg" alt="▶ Click to watch the pace demo on YouTube" width="100%">
</a>

<p align="center">
  <strong><a href="https://www.youtube.com/watch?v=UElmyC06ryM">▶ Click the thumbnail to play the demo</a></strong>
</p>

---

# pace

**Self-hosted news aggregator and personal content dashboard.**

Aggregate Hacker News, RSS, GitHub, Lemmy, Mastodon, YouTube, arXiv, and 10 more sources into a single dashboard you own. Filter, deduplicate, score, and optionally use an LLM to summarize and rank what matters to you. Runs as a single process (Bun or Docker) with zero client-side JavaScript.

- **19 built-in sources** - Hacker News, RSS/Atom, GitHub, Lemmy, Mastodon, YouTube, arXiv, npm, Wikipedia, and more (Reddit and Twitter/X need extra setup - see [adapter caveats](#adapter-caveats))
- **Configurable in YAML** - adapters, transforms, layout, and LLM settings in one file
- **Agent-friendly setup** - humans install skills with `npx skills`; agents use `pace skill`
- **Self-hosted** - one-line Docker deploy, or Bun from source
- **Optional AI-powered filtering** - LLM summarization, ranking, and filtering via any OpenAI/Anthropic/Google/Groq provider
- **No client-side JavaScript** - server-rendered HTML, fast on any device
- **Layout widgets** - embed images, text/markdown, and iframes directly in your dashboard layout

### Example dashboards

Ready-made configs in [`examples/`](examples/) — copy a YAML, validate with `pace config check`, and serve.

| | | | |
|:---:|:---:|:---:|:---:|
| [![Morning Brief](./examples/morning-brief.png)](./examples/morning-brief.yaml) | [![Dev Radar](./examples/dev-radar.png)](./examples/dev-radar.yaml) | [![Indie Web](./examples/indie-web.png)](./examples/indie-web.yaml) | [![Open Source Launchpad](./examples/open-source-launchpad.png)](./examples/open-source-launchpad.yaml) |
| [Morning Brief](./examples/morning-brief.yaml) | [Dev Radar](./examples/dev-radar.yaml) | [Indie Web](./examples/indie-web.yaml) | [Open Source Launchpad](./examples/open-source-launchpad.yaml) |
| [![Release Cockpit](./examples/release-cockpit.png)](./examples/release-cockpit.yaml) | [![Science Desk](./examples/science-desk.png)](./examples/science-desk.yaml) | [![Layout System](./examples/layout-system.png)](./examples/layout-system.yaml) | [![Widgets Gallery](./examples/widgets-gallery.png)](./examples/widgets-gallery.yaml) |
| [Release Cockpit](./examples/release-cockpit.yaml) | [Science Desk](./examples/science-desk.yaml) | [Layout System](./examples/layout-system.yaml) | [Widgets Gallery](./examples/widgets-gallery.yaml) |

<p align="center">Example layouts above. See <a href="#quick-start">Quick start</a> to run pace — agent skills, CLI, or Docker.</p>

## Quick start

### Humans: use an agent

Install pace's bundled skills into your coding agent, then ask it to set up a dashboard. No pace binary required.

```bash
npx skills add av/pace --skill pace-setup     # install and run
npx skills add av/pace --skill pace-config # create or edit config.yaml
```

List all available skills: `npx skills add av/pace --list`.

### Agents: install the CLI

Clone pace, install dependencies, then read skills from the binary:

```bash
git clone https://github.com/av/pace.git && cd pace
bun install && npm link

pace skill                          # list agent skills
pace skill pace-setup     # set up / run a dashboard
pace skill pace-config # create or edit config.yaml
```

Before `npm link`, use `bun run src/cli.ts skill …` instead of `pace skill …`. The Docker image also ships skills: `docker run --rm ghcr.io/av/pace pace skill`.

### Docker

```bash
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest
```

Open http://localhost:7453. Health check: `curl http://localhost:7453/health` returns `{"status":"ok"}`. Ships with the default config (Hacker News, Lobsters, GitHub trending/releases, engineering blogs, DEV.to).

### Presets

Bundled configs you can run today. Use `--preset` (or `-P`):

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

List presets: `pace presets list` (or `pace --list-presets`)

#### Preset showcase

| | |
|---|---|
| ![Tech News preset](./assets/preset-tech-news.png) | **`tech-news`** HN + Lobsters frontpage pipeline, Lemmy communities, tech RSS (Ars Technica, New Stack, Go, TypeScript), GitHub releases, reference bookmarks, and pipeline legend in a multi-column layout. The default starting point for software engineers. |
| **`ml-ai`** arXiv papers, Hacker News AI, Local Llama, curated ML blogs, and release tracking. Built for researchers and practitioners following the fast-moving AI/ML space. | ![ML & AI preset](./assets/preset-ml-ai.png) |
| ![Daily Brief preset](./assets/preset-daily-brief.png) | **`daily-brief`** Breaking news digest, Wikipedia in-the-news and most-read, today-in-history, and top Hacker News stories. A morning briefing you can scan in two minutes. |
| **`product-launches`** Product Hunt, Show HN, GitHub trending repos, npm new packages, and community discussions. Stay on top of what's shipping across the indie and open-source ecosystem. | ![Product Launches preset](./assets/preset-product-launches.png) |
| ![Academic Papers preset](./assets/preset-academic-papers.png) | **`academic-papers`** arXiv categories and search, Stack Exchange research, science writing blogs, and Hacker News. Designed for academics and researchers tracking new publications. |
| **`release-tracker`** GitHub releases for key projects, trending repos, Lobsters, and Hacker News. Follow what's shipping across the open-source ecosystem. | ![Release Tracker preset](./assets/preset-release-tracker.png) |
| ![Video & Podcast preset](./assets/preset-video-podcast.png) | **`video-podcast`** YouTube channels, podcast feeds, and Mastodon discussions. Keep up with video and audio content creators in one view. |

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

Validate before serving: `pace config check config.yaml`

## Content adapters

Pace ships with 19 adapters that pull content from public APIs and local config. Each adapter has a configurable `refresh_interval` (in minutes, default: 15).

| Adapter | Source |
|---------|--------|
| `hackernews` | Hacker News (top, new, best, ask, show) |
| `reddit` | Reddit subreddits |
| `rss` | Any RSS/Atom feed |
| `github` | GitHub trending repos + release tracking |
| `github-releases` | GitHub release notes from specific repos |
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
| `bookmarks` | Curated link lists from config (no network fetch) |
| `counter` | JSON endpoint metrics with stat-card display |

### Bookmarks adapter

Display curated link lists defined directly in config (no network fetch required).
Params: `items` (required array; each entry needs `title` and `url`; optional `description`, `tags`).

```yaml
- name: tools
  type: bookmarks
  params:
    items:
      - title: Linear
        url: https://linear.app
        description: Issue tracker
        tags: [work]
```

### Counter adapter

Fetch a JSON endpoint and extract a numeric value for stat-card display. Supports trend arrows via a comparison endpoint and env var interpolation in headers.
Params: `url` (required), `json_path` (required), `label`, `unit`, `compare_url`, `compare_path` (defaults to `json_path` when `compare_url` is set), `headers`.

```yaml
- name: github-stars
  type: counter
  params:
    url: https://api.github.com/repos/oven-sh/bun
    json_path: stargazers_count
    label: "Bun Stars"
    unit: "stars"
```

### Adapter caveats

Some adapters are listed above but do not work out of the box:

- **`reddit`** - Reddit's public unauthenticated `.json` API often returns **HTTP 403** upstream. Bundled presets intentionally omit Reddit for this reason. For community discussions without credentials, use **`lemmy`** instead (included in the `tech-news` and `ml-ai` presets).
- **`twitter`** - Requires `bearer_token` in adapter params. Without it, the adapter **always returns an empty list** (no error). Run `pace adapters explain twitter` for setup details.

```bash
pace adapters list            # list all adapter types
pace adapters explain <type>  # show params and example
pace config check [path]      # validate a config file
```

## Transforms

Transforms process content after fetching - filter, deduplicate, rank, or enrich items before they reach the dashboard.

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
| `llm-rank` | Rank items 0-10 by relevance to your interests |
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

Arrange panels in a recursive flexbox tree. Each node is a flex container, a panel, or a widget.

**Flex container** - groups children in a row or column.
Options: `direction` (row/column, required), `children` (required), `flex`, `gap`.

**Panel** - displays content from an adapter or pipeline.
Options: `panel` (name, required), `source` (required), `id`, `flex`, `limit`, `display` (only value: `counter` for stat-card rendering with counter adapters).

```yaml
layout:
  direction: row
  gap: 12px
  children:
    - panel: main-feed
      source: curated-feed
      flex: 2
    - direction: column
      flex: 1
      gap: 12px
      children:
        - panel: releases
          source: gh-releases
        - panel: papers
          source: arxiv
```

Responsive - collapses to a single column on mobile (below 768px).

### Widgets

Layout nodes can also be widgets - static content that doesn't come from an adapter.

**Image widget** - display a static image with optional link.
Options: `image` (URL, required), `flex`, `alt`, `object_fit` (cover/contain/fill/none), `max_height`, `link`.

```yaml
- image: https://example.com/banner.png
  alt: Site banner
  link: https://example.com
  object_fit: cover
  max_height: 200px
```

**Text widget** - inline text, markdown, or HTML.
Options: `text` (content, required), `format` (plain/markdown/html), `title`, `flex`.

```yaml
- text: "## Welcome\nDaily reading list."
  title: Notes
  format: markdown
```

**Iframe widget** - embed an external page with sandbox security.
Options: `iframe` (URL, required), `flex`, `title`, `height` (CSS length: `px`, `rem`, `em`, `vh`, or `%`; e.g. `400px`, `20rem`, `50vh`), `aspect_ratio` (format `N/N`, e.g. `16/9`), `sandbox`, `allow`.

```yaml
- iframe: https://example.com/embed
  title: Live Dashboard
  aspect_ratio: 16/9
```

Set `display: counter` on the **panel** (not the adapter) to render stat cards instead of the default list view:

```yaml
- panel: stats
  source: github-stars
  display: counter
```

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

See [Quick start](#quick-start): humans install skills with `npx skills add av/pace`; agents clone pace and use `pace skill`. The [`examples/`](examples/) directory pairs the screenshots above with reference configs to study when writing `config.yaml`.

## Tech stack

Bun + Hono + SQLite + JSX server rendering. No client-side JavaScript.

## License

MIT

---

![Pace - self-hosted news aggregator dashboard showing Hacker News, Lemmy, GitHub, RSS feeds, and more in a configurable layout](./assets/splash.jpg)
