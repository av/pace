# pace

**The digest your agent reads so it doesn't have to hunt.**

Pace is a self-hosted service that fetches the sources you follow on a schedule, filters and ranks them with rules you keep in YAML, and serves the result as one bounded brief. Your agent reads `/brief.md` once and tells you what happened, instead of searching and fetching a dozen pages every time you ask "what's new?".

| Approach | What it costs |
|----------|---------------|
| Agent searches and fetches live | Tokens, tool calls and flaky pages, every session |
| A page someone vibe-coded | No stable schema; the agent re-parses HTML |
| Asking a chatbot "what's new in AI?" | It doesn't know your sources |
| Pace | Fetched and filtered offline on a schedule; the agent reads one bounded, structured brief |

It runs as one Bun process or Docker container with SQLite storage. Ranking is plain code (engagement, recency, dedupe across sources); LLM transforms are optional.

## Quickstart

Run pace with the `ml-ai` preset and read the brief:

```bash
docker run -d -p 7453:7453 -v pace-data:/app/data ghcr.io/av/pace:latest --preset ml-ai
curl -s localhost:7453/brief.md    # the first fetch takes up to a minute
```

Hook up your agent with the bundled skill:

```bash
npx skills add av/pace --skill pace-brief
```

The `pace-brief` skill tells your agent to read the brief once, cite items as `[n]` with their links, and search the web only for something the brief doesn't cover. No skill support? Point the agent at the URL in its instructions, or put the brief straight into its context:

| Surface | What you get |
|---------|--------------|
| `GET /brief.md` | Markdown written for one LLM read: numbered `[n]` items with link, source, age, score and a `why:` line |
| `GET /api/brief` | The same brief as versioned JSON (`pace.brief/v1`) |
| `pace brief` | The same Markdown (or `--json`) from the local database, no server needed |

The brief covers the last 72 hours, deduped across panels, ranked, and capped at 40 items and 8 per panel. Change that with `?since=24h`, `?panel=`, `?limit=` and `?per_panel=`. Each brief states its own size ("About 3117 tokens") so you can budget for it. Schema, parameters and ranking: [docs/brief.md](docs/brief.md).

Other presets: `tech-news`, `daily-brief`, `product-launches`, `release-tracker`, `academic-papers`, `video-podcast` ([docs/presets.md](docs/presets.md)). Running from source, your own config, or behind a reverse proxy: [docs/install.md](docs/install.md).

## Measured

Claude Sonnet 5 as a headless Claude Code agent on 2026-09-27, asking "what's new in ML/AI today that matters to me?" 5 times each way:

| Mean per run | Tool calls | Wall time | Input tokens | Cost |
|--------------|-----------:|----------:|-------------:|-----:|
| Web tools, given the user's source list | 14.6 | 51s | 270k | $0.42 |
| Same agent reading the `ml-ai` brief | 1 | 15s | 22k | $0.03 |

Most of the search arm's input tokens are read by the small model behind Claude Code's `WebFetch`; the answering model itself saw about 1.6x more input. A harness that pastes pages straight into context would split this differently. The search answers covered more ground, including posts and releases older than the brief's window, and also passed off week-old launches as today's news.

Results, method and every answer: [scripts/brief-demo/results.md](scripts/brief-demo/results.md). Script and transcripts: [scripts/brief-demo](scripts/brief-demo/).

## Make it yours

The brief is only as good as its sources. A config is a list of sources, the transforms that filter and rank them, and panels that group them:

- **19 source adapters**: Hacker News, RSS/Atom, GitHub trending and releases, arXiv, Lobsters, Lemmy, Mastodon, YouTube, npm, Wikipedia, dev.to, Stack Exchange, Product Hunt, podcasts, and more.
- **Transforms**: filter, exclude, dedupe, time-decay, keyword scores, clustering, and optional LLM summarize, filter, rank and merge (OpenAI, Anthropic, Google, Groq, Mistral or any OpenAI-compatible endpoint).
- **Pipelines** merge several sources into one panel and rank them together.

Start from a preset or [`config.example.yaml`](config.example.yaml), or have your agent write one with `npx skills add av/pace --skill pace-config`. Mount it into the container as `/app/config.yaml` ([docs/install.md](docs/install.md#custom-docker-config)) and check it with `pace config check`. Reference: [docs/configuration.md](docs/configuration.md).

## The dashboard

The brief comes with a dashboard that shows the same data. It's the debug view: if an item is in the brief, it's on a panel, so you can see what your agent will read and why.

<p align="center">
  <a href="https://www.youtube.com/watch?v=UElmyC06ryM"><img src="./assets/splash.jpg" alt="Pace dashboard showing multiple feed panels in a configurable layout" width="100%"></a>
</p>

Open http://localhost:7453, or [watch the 2-minute demo](https://www.youtube.com/watch?v=UElmyC06ryM). It is also a keyboard-driven feed reader with read state, stars, per-panel JSON and RSS, saved-search feeds, webhook alerts and static snapshots you can share.

## Docs

| | |
|---|---|
| [brief.md](docs/brief.md) | The agent brief: endpoints, parameters, ranking, `pace.brief/v1` schema |
| [install.md](docs/install.md) | Agent skills, Docker, presets, from source, custom config |
| [server.md](docs/server.md) | Port, env vars, `server:` block, reverse proxy, retention, `/health` |
| [configuration.md](docs/configuration.md) | Adapters, transforms, pipelines, layout, LLM setup |
| [presets.md](docs/presets.md) | Bundled presets and example dashboards, with screenshots |
| [api.md](docs/api.md) | HTTP API: panels, search, read state, stars, RSS feeds |
| [cli.md](docs/cli.md) | `pace config check`, `doctor`, `import`/`export` OPML, `search`, `panels list` |
| [notifications.md](docs/notifications.md) | Webhook alerts to ntfy, Discord, Slack or any URL |
| [dashboard.md](docs/dashboard.md) | Keyboard shortcuts, read state, stars, installable app, offline view |
| [sharing.md](docs/sharing.md) | Static snapshots and GitHub Gist publishing |
| [development.md](docs/development.md) | Tech stack and working on the repo |

## License

MIT
