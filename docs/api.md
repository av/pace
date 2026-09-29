# HTTP API

Every endpoint pace serves besides the dashboard page itself. The endpoint an agent reads is the brief; the rest serve panel data, search, read state and stars as JSON or RSS. `/health` is in [server.md](server.md#health---liveness-and-refresh-health).

## `/brief.md` and `/api/brief` - the agent brief

What the panels show, packed for one read: items from the last 72 hours (`?since=`), deduped across panels, ranked, and capped at 40 items (`?limit=`) and 8 per panel (`?per_panel=`), with `?panel=` to pick panels. `/brief.md` is Markdown with `[n]` citation numbers and a why line per item; `/api/brief` is the same brief as `pace.brief/v1` JSON. `pace brief` (`--json`, `--panel`, `--since`, `--limit`, `--per-panel`) reads it from the local database. Field reference: [docs/brief.md](brief.md).

```bash
curl 'http://localhost:7453/brief.md?since=24h&limit=20'
```

## `/api/panels` - JSON panel data

The dashboard's data is also served as read-only JSON, for scripts, widgets, and monitors that want data instead of HTML.

`GET /api/panels` lists every panel with its id, display name, refresh sources, current item count, and last refresh time:

```json
{
  "panels": [
    { "id": "tech-panel", "name": "Tech", "sources": ["hackernews"], "item_count": 30, "last_refreshed_at": "2026-07-08T00:00:00Z" }
  ]
}
```

`GET /api/panels/<panel>` returns one panel's deduped items, newest first, accepting the panel id or display name (same lookup as `POST /refresh/<panel>`). Each item carries `id`, `title`, `url`, `source`, `timestamp`, `fetched_at`, `summary`, `body`, `score` (from `llm-rank`, if any), and `origins` (contributing feeds for merged items). An optional `?limit=N` (1-500) overrides the panel's configured item limit:

```bash
curl http://localhost:7453/api/panels/tech-panel?limit=5
```

Append `.rss` to the panel segment to get the same items as an RSS 2.0 feed instead of JSON, so any panel — including transform pipelines that dedupe, rank, or summarize — can feed a regular feed reader:

```bash
curl http://localhost:7453/api/panels/tech-panel.rss
```

Feed items carry the title, link, a stable non-permalink `guid`, the source feed as `category`, `pubDate`, and a `description` (the LLM summary when one exists, otherwise the item body). The same `?limit=` override applies.

`GET /api/search?q=<terms>` searches every stored item — everything in the database, not just what the dashboard currently renders — for items matching **all** whitespace-separated terms, case-insensitively, in the title, URL, source, summary, or body (the same semantics as the dashboard's `/` filter bar). Results are the same deduped items the panel API serves, newest first, each carrying an extra `panel` field naming the panel it lives on. A `starred:yes` or `starred:no` term filters by star state instead of matching text (`q=starred:yes` alone lists everything you've starred), and `seen:yes` / `seen:no` does the same for read state — `q=rust seen:no` finds only the Rust stories you haven't read yet, and the two operators combine. Optional `?panel=<id-or-name>` scopes the search to one panel — or put a `panel:<id>` operator straight in the query (`q=rust seen:no panel:hacker-news`), the same grammar the filter bar speaks, so a bar query pastes into `q` verbatim; giving both forms at once is a 400. `?limit=N` (1-500, default 50) caps the result count:

```bash
curl 'http://localhost:7453/api/search?q=rust+wasm&limit=10'
```

`GET /api/search.rss?q=<terms>` is the same search rendered as an RSS 2.0 feed — subscribe to any query as a **saved search** in a regular feed reader and new matches from any source show up there. Same term semantics, `?panel=` scoping, and `?limit=` cap as the JSON endpoint; the channel is titled after the query and the feed's self link keeps the query string, since that is the feed's identity. The dashboard's `/` filter bar speaks the same grammar — `starred:yes/no` and `seen:yes/no` tokens filter the rendered items by state (e.g. `rust seen:no`, or `starred:yes` alone for your pins), state marks re-filter live as you star or read things, and a `panel:<id>` token scopes the filter to one panel (mapped to `?panel=` in the feed link) — and it links every non-empty query here (the **RSS** link), so a filter you keep typing is one click from becoming a feed:

```bash
curl 'http://localhost:7453/api/search.rss?q=rust+wasm'
```

## `/api/seen` - read state

`GET /api/seen` lists the keys of every item marked seen (pressing `x` on the dashboard), and `POST /api/seen` with `{"key": "...", "seen": true}` sets or clears one mark — or `{"keys": ["...", "..."], "seen": true}` sets or clears up to 500 marks atomically (pressing `a` marks a whole panel this way). Keys are the item's dedup identity — the normalized URL, or the item id when there is no URL — so marking a story seen covers its copies on every panel. Seen state lives in the server's SQLite database, shared by every browser that opens the dashboard, and marks age out with `server.retention_days` once no stored item carries the key:

```bash
curl http://localhost:7453/api/seen
```

## `/api/star` - starred items

`GET /api/star` lists the keys of every starred item (pressing `s` on the dashboard), and `POST /api/star` with `{"key": "...", "starred": true}` sets or clears one star — the same dedup-identity keys as `/api/seen`, so a star covers a story's copies on every panel. `GET /api/star.rss` serves the starred items themselves as an RSS 2.0 feed, most recently starred first — your reading list of pinned stories, subscribable from any feed reader or fetchable as portable XML (`?limit=N`, 1-500, caps it). Each entry appears once no matter how many panels carry a copy, and a star whose item has aged out of retention simply drops from the feed until the story returns:

```bash
curl http://localhost:7453/api/star.rss
```

Unknown panels return a JSON 404 (`{"error": "Unknown panel: ..."}`). All of these endpoints respect `server.base_path`.
