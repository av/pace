# The Pace brief

The brief is what an agent reads instead of browsing. Pace fetches and filters your sources on a schedule; the brief packs what your panels show into one bounded document: windowed, deduped across panels, ranked, and capped. An agent reads it once and tells you the story.

The dashboard is the debug view of the same data. If an item is in the brief, it is on a panel.

## Getting it

| Surface | Format |
|---------|--------|
| `GET /brief.md` | Markdown for one LLM read (`text/markdown`) |
| `GET /api/brief` | JSON, schema `pace.brief/v1` |
| `pace brief` | Markdown from the local database, no server needed |
| `pace brief --json` | The same JSON document |

```bash
curl -s localhost:7453/brief.md
curl -s 'localhost:7453/api/brief?since=24h&limit=20'
pace brief -P ml-ai --since 24h
```

`pace brief` reads the stored database only. It never fetches, so it is fast and free, and it is only as fresh as the last refresh (`pace serve` keeps it fresh).

## Parameters

The endpoints take query parameters and the CLI takes flags. They behave the same way.

| Query | CLI | Default | Meaning |
|-------|-----|---------|---------|
| `panel` | `--panel` | every panel except bookmarks/counter ones | Panel id or display name. Repeat it or comma-separate. Naming a bookmarks/counter panel includes it. Unknown panel: 404 / error. |
| `since` | `--since` | `72h` | A duration (`90m`, `24h`, `3d`, `1w`), an ISO date or datetime, or `all`. Items published before the cutoff are dropped. |
| `limit` | `-n`, `--limit` | `40` | Maximum items in the brief, 1-200. |
| `per_panel` | `--per-panel` | `8` | Maximum items from one panel, 1-50. |
| | `--json` / `--md` | Markdown | Output format for the CLI. |
| | `-c`, `-P`, `-C` | | Config file, preset, working directory, as for every other command. |

Invalid values are a 400 with `{"error": "..."}` (plain text on `/brief.md`) and a `brief:` error on the CLI.

## How items are chosen

1. **Candidates.** For each panel in scope: the items that panel shows on the dashboard (its `limit`, the same URL dedup window). Panels fed only by `bookmarks` or `counter` adapters are reference links and metrics, not news, so they are skipped unless you name them.
2. **Window.** Items published before `since` are dropped.
3. **Dedupe.** One story, one entry. Items merge when they share the dashboard's dedup identity (URL, case-folded, trailing slash dropped) or the same normalized title (20+ characters, so "Weekly notes" never merges). The story is filed under a regular adapter panel first, then a pipeline panel, then a `source: all` panel. The other panels it appeared in go in `also_in`.
4. **Score** (0-100, see below).
5. **Selection.** Panels take turns in layout order (round-robin), each giving its best remaining story, until `limit` is reached or every panel hits `per_panel` or runs dry. Within a panel, a source that already has 3 picks waits until the panel's other sources have had a turn, so a release panel is not eight nightly builds of one repo.
6. **Order.** Sections follow the layout; items within a section are best-first. `n` numbers items across the whole brief, top to bottom.

### Score

```
engagement = log(1 + E) / log(1 + max E in this brief)      (0 when no item has engagement)
recency    = 2 ^ -(age / 24h)                                (age from generated_at)
cross      = min(1, other panels the story appeared in / 2)
base       = 0.4 * engagement + 0.4 * recency + 0.2 * cross
score      = round(100 * base)                               without an llm-rank score
score      = round(100 * (0.5 * llm_score / 10 + 0.5 * base)) with one
```

`E` is weighted engagement parsed from the item's metadata: points, upvotes, stars, likes, boosts and favorites count 1, comments and replies 0.5. Scores are relative: they compare items within one brief, not across briefs. Papers and blog posts have no engagement counts, so they rank on recency and cross-panel presence. Round-robin selection keeps those panels from being crowded out.

The brief does not re-run your transforms. `filter`, `keyword-score` with `min_score`, `llm-filter` and `latest` already decided what reaches a panel. The brief ranks what survived and says why.

## `pace.brief/v1`

```json
{
  "schema": "pace.brief/v1",
  "generated_at": "2026-09-26T10:05:12Z",
  "config": "preset:ml-ai",
  "scope": {
    "panels": ["79d027c4", "b0b3223a"],
    "skipped_panels": ["d7abf8ec"],
    "since": "2026-09-23T10:05:12Z",
    "window": "72h",
    "limit": 40,
    "per_panel": 8
  },
  "counts": {
    "panels": 7,
    "candidates": 100,
    "older_than_window": 34,
    "duplicates_merged": 16,
    "selected": 33,
    "cut_by_limits": 17
  },
  "token_estimate": { "method": "chars/4", "markdown": 3196, "json": 7548 },
  "panels": [
    {
      "id": "b0b3223a",
      "name": "hacker-news-ai",
      "kind": "adapter",
      "last_refreshed_at": "2026-09-26T09:53:23Z",
      "candidates": 12,
      "older_than_window": 0,
      "listed_elsewhere": 0,
      "selected": 8
    }
  ],
  "items": [
    {
      "n": 10,
      "id": "hn:49849985",
      "title": "Revealing the details of how OpenAI agents hacked Hugging Face",
      "url": "https://swarmtraces.org/",
      "source": "hackernews:top",
      "panel": "b0b3223a",
      "panel_name": "hacker-news-ai",
      "also_in": ["cross-talk"],
      "score": 76,
      "llm_score": null,
      "engagement": { "points": 485, "comments": 293 },
      "summary": null,
      "why_ranked": ["485 points, 293 comments", "also in cross-talk", "published 12h ago"],
      "published_at": "2026-09-25T21:09:27.000Z",
      "fetched_at": "2026-09-26T09:53:23Z",
      "discussion_url": "https://news.ycombinator.com/item?id=49849985"
    }
  ]
}
```

### Header

| Field | Type | Meaning |
|-------|------|---------|
| `schema` | string | Always `pace.brief/v1` for this shape. |
| `generated_at` | ISO 8601 UTC | When the brief was built. Ages and recency are measured from here. |
| `config` | string | `preset:<name>` for bundled presets, otherwise the config file name (never a full path). |
| `scope.panels` | string[] | Panel ids in the brief, in layout order. |
| `scope.skipped_panels` | string[] | Bookmarks/counter panels left out by default. Empty when a panel filter was given. |
| `scope.since` | ISO 8601 UTC or null | Cutoff; null for `since=all`. |
| `scope.window` | string | The window as asked: `72h`, `all`, or `since <iso>`. |
| `scope.limit`, `scope.per_panel` | integer | The caps in effect. |
| `counts.panels` | integer | Panels in scope. |
| `counts.candidates` | integer | Items shown on those panels, before the window. A story on three panels counts three times. |
| `counts.older_than_window` | integer | Candidates dropped by `since`. |
| `counts.duplicates_merged` | integer | Candidates folded into another entry of the same story. |
| `counts.selected` | integer | Items in `items`. |
| `counts.cut_by_limits` | integer | Distinct stories in the window that `limit`/`per_panel` left out. |
| `token_estimate` | object | `markdown` and `json`: rough token counts of each rendering, characters / 4. Good for budgeting, not billing. |
| `panels[]` | object[] | One row per panel in scope: `id`, `name`, `kind` (`adapter`, `pipeline`, `all`), `last_refreshed_at`, `candidates`, `older_than_window`, `listed_elsewhere` (stories filed under another panel), `selected`. |

### Items

| Field | Type | Meaning |
|-------|------|---------|
| `n` | integer | Citation number, 1-based, unique within the brief. |
| `id` | string | Stored item id (stable across refreshes for most adapters). |
| `title` | string | Item title, whitespace collapsed. |
| `url` | string | Link to the item. May be empty for a few adapters. |
| `source` | string | Source tag from the adapter (`hackernews:top`, `arxiv:cs.AI`, a feed title). |
| `panel`, `panel_name` | string | The panel the item is filed under: id and display name. |
| `also_in` | string[] | Display names of other panels in scope that showed the same story. |
| `score` | integer 0-100 | Brief score, see above. |
| `llm_score` | number or null | Stored `llm-rank` score (0-10) when that transform ran. |
| `engagement` | object | Counts parsed from the item: any of `points`, `upvotes`, `stars`, `likes`, `boosts`, `favorites`, `comments`, `replies`. Empty when none. |
| `summary` | string or null | The stored LLM summary if one exists, else a plain-text excerpt of the body (HTML, metadata, and annotations removed; arXiv keeps only the abstract), at most 280 characters. Null when nothing is left; Pace does not invent one. |
| `why_ranked` | string[] | Plain-words reasons, in this order when present: `llm-rank N/10`, engagement counts, `keyword-score N (terms)` (when the transform annotates), `clustered with related stories: <label>`, `also in <panels>`, `published <age> ago`. |
| `published_at` | ISO 8601 UTC | The item's own timestamp. |
| `fetched_at` | ISO 8601 UTC | When Pace stored it. |
| `discussion_url` | string or null | Comments page when the adapter records one (Hacker News, Lemmy, Lobsters). |

### Compatibility

Within `pace.brief/v1`, fields are only added, never renamed, removed, or given a new meaning. Consumers should ignore fields they do not know. A breaking change gets a new schema string (`pace.brief/v2`), and the version appears in both renderings. The score formula may be tuned inside v1; treat `score` as an ordering hint, not a stable number.

## Markdown rendering

`/brief.md` holds the same items as the JSON, written for a model to read once:

```markdown
# Pace brief: preset:ml-ai

Generated 2026-09-26T09:57:57Z. Window: items from the last 72h (since 2026-09-23T09:57:57Z).
33 items from 7 panels; 100 candidates, 34 older than the window, 16 duplicates merged, 17 cut by limits. About 3196 tokens.
Skipped reference panels: ml-resources.
Items are numbered [n] across the whole brief; cite them as [n] with the URL. Scores run 0-100 and only compare items within this brief. Schema pace.brief/v1.

## hacker-news-ai

- [9] Ollaya – Ollama for open-source, Jev-style decision models
  https://ollaya.dev/ · hackernews:top · 15h ago · score 83
  why: 457 points, 117 comments; also in firehose, cross-talk
  discussion: https://news.ycombinator.com/item?id=49848269

## firehose

Nothing new here (3 listed under other panels, 5 older than the window).
```

No HTML: titles and summaries are single lines, and a literal `<` is escaped as `\<`. A panel with nothing to show still gets a one-line section explaining why, so a reader can tell "quiet" from "broken".

## For agents

The bundled `pace-brief` skill (`pace skill pace-brief`) is the reading contract: fetch the brief once, narrate it with `[n]` citations, and search the web only for a gap the user or the brief names.
