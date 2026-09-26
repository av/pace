---
name: pace-brief
description: >
  Answer "what's new" questions from the user's Pace brief instead of browsing. Read the
  brief once (curl localhost:7453/brief.md or pace brief), narrate it with [n] citations,
  and use web search only for a gap the user or the brief names. Use when asked what's new,
  for a morning or daily brief, for news in the user's areas (AI, ML, releases, papers,
  tech), or "anything I should know about" a topic their Pace dashboard covers.
compatibility: Needs a running pace server (default http://localhost:7453) or the pace CLI with a filled database.
---

# Read the Pace brief

The user already told Pace which sources they care about, and Pace fetched and filtered them on a schedule. The brief is that work packed into one bounded document. Read it once, then tell the story. Do not re-do Pace's job with search tools.

## 1. Get the brief (one call)

```bash
curl -s localhost:7453/brief.md
```

Without a server, the CLI reads the same data from the local database:

```bash
pace brief
pace brief -P ml-ai        # when the user runs a bundled preset
```

Options, the same on both (query parameters on the URL, flags on the CLI):

| URL | CLI | Use it for |
|-----|-----|-----------|
| `?since=24h` | `--since 24h` | "today", "this morning" (default `72h`; also `90m`, `3d`, `1w`, an ISO date, `all`) |
| `?panel=papers` | `--panel papers` | one area of the dashboard (panel id or name; repeat for more) |
| `?limit=15` | `--limit 15` | a shorter brief (default 40 items) |
| `?per_panel=3` | `--per-panel 3` | fewer items per section (default 8) |

If Pace runs on another host or port, swap that address in. For structured data, `GET /api/brief` (or `pace brief --json`) returns the same items as `pace.brief/v1` JSON. Fields are documented in `docs/brief.md`.

Fetch once per question. If the user then asks about one section, fetch that panel with `?panel=`. Do not page through the whole brief again.

## 2. Read the header before the items

The first lines say when the brief was generated, the time window, how many items survived, and roughly how many tokens it is. Check two things:

- **Freshness.** If `Generated` is old, or a section says `no stored items yet`, say so plainly ("Pace last refreshed 2 days ago") instead of presenting stale items as today's news.
- **Coverage.** A section with `Nothing new here (...)` is quiet, not broken. Mention it in one line only if the user asked about that area.

## 3. Narrate

- Lead with what matters most to this user: high `score`, big engagement in the `why:` line, stories that show up in several panels (`also in ...`). Group related items into a few threads rather than walking the sections in order.
- Cite every item you mention as `[n]` with its URL, e.g. `Ollama now runs on MLX by default [31](https://github.com/ollama/ollama/releases/tag/v0.40.0-rc0)`. Use the brief's own numbers; never renumber.
- Use the brief's facts: title, source, age, summary, engagement. Don't add claims the brief doesn't support. If an item has no summary, describe it from its title and say that's all you have.
- Keep it short: a paragraph or a bulleted list of 5-10 items is usually right. Offer to go deeper on any thread.
- Say what you left out ("12 more papers, mostly on evals") so the user knows the brief was read, not skimmed.

## 4. Search only for a named gap

The brief is the default and usually the whole answer. Use web search or fetch tools only when:

1. **The user names something the brief doesn't cover** ("what about the new Gemini release?" and no item mentions it). Search for that one thing and say the result came from outside Pace.
2. **The user asks to go deeper on one item** ("what's in that paper?"). Open that item's URL (or `discussion:` link), not a general search.
3. **The brief itself is empty or stale** and the user still wants an answer. Say so first, then search.

Do not search to "verify" or "complete" items that are in the brief, and do not run general "latest AI news" searches alongside it. That spends the tokens and time the brief exists to save, and it drifts away from the sources the user chose.

## Example

User: what's new in AI today that matters to me?

1. `curl -s 'localhost:7453/brief.md?since=24h'`
2. Answer from the brief:

> Two things stood out on Hacker News. A write-up of how OpenAI's agents got into Hugging Face drew 485 points [10](https://swarmtraces.org/), and a U.S. appeals court upheld the Pentagon's supply-chain-risk designation for Anthropic, with 766 comments [12](https://www.cnbc.com/...). In local models, a Qwen3.8 27B prefiller from ISTA-DASLab is circulating [18](https://huggingface.co/...). llama.cpp shipped three builds with CPU and OpenCL kernel work [28]-[30]. The papers section is quiet today: nothing newer than 36h.
>
> Want the details on any of these?

No search calls. If the user follows up with "and the new Mistral model?" and the brief has nothing on it, that is a named gap: search once and say it came from the web.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `curl: (7) Failed to connect` | Pace isn't running. Use `pace brief` if the CLI is installed, or ask the user to start it (`pace skill pace-setup`). |
| Every section says `Nothing new here` | Widen the window: `?since=3d` or `?since=all`. |
| `Unknown panel: X` | List panels with `curl -s localhost:7453/api/panels` or `pace panels list`. |
| Brief is too long for your budget | `?limit=15&per_panel=3`. The header's token estimate tells you the size before you read further. |
