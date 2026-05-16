# pace

Self-hostable personal dashboard that aggregates online content, produces LLM-powered summaries, and supports personalization through interest-based lensing.

## Features

- **Pluggable adapters** — RSS/Atom, Hacker News, GitHub Releases, Reddit (Twitter stub included)
- **LLM integration** — summarization, daily digest, interest-based lensing via any OpenAI-compatible provider
- **Dark monochrome UI** — server-rendered with Hono JSX, responsive CSS grid
- **SQLite storage** — WAL mode, deduplication, automatic pruning
- **Single config file** — YAML with environment variable support

## Quick start

```bash
bun install
cp config.example.yaml config.yaml
# edit config.yaml with your feeds
bun run dev
```

Open http://localhost:3000

## Docker

```bash
cp config.example.yaml config.yaml
docker build -t pace .
docker run -d -p 3000:3000 -v ./config.yaml:/app/config.yaml -v pace-data:/app/data pace
```

## Configuration

See `config.example.yaml` for all options.

### Adapters

| Type | Params |
|------|--------|
| `rss` | `urls: string[]` |
| `hackernews` | `stories: top\|new\|best`, `limit: number` |
| `github-releases` | `repos: string[]` (owner/repo format) |
| `reddit` | `subreddits: string[]`, `sort: hot\|new\|top`, `limit: number` |

Each adapter has a `refresh_interval` in minutes (default: 15, minimum: 1).

### LLM

Supports any provider via [@mariozechner/pi-ai](https://github.com/badlogic/pi-mono) — OpenAI, Anthropic, Google, Groq, Mistral, xAI, DeepSeek, or any OpenAI-compatible endpoint via `base_url`.

```yaml
llm:
  provider: openai
  model: gpt-4o-mini
  api_key: ${OPENAI_API_KEY}
  digest:
    max_length: 500
    style: brief
    focus_areas: [ai, programming]
  interests: [artificial intelligence, typescript]
```

### Layout

```yaml
layout:
  panels:
    - all        # combined feed from all adapters
    - rss        # per-adapter panel
    - hackernews
    - digest     # LLM-generated digest
```

## Tech stack

Bun + Hono + SQLite + JSX server rendering. No client-side JavaScript.

## License

MIT
