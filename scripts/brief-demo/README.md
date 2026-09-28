# Brief demo: the same question with and without Pace

`run.sh` asks one headless agent "What's new in ML/AI today that matters to me?" in three ways and records every run. `summarize.ts` turns the transcripts into [results.md](results.md): the full per-run table, the method, and every answer.

```bash
pace serve -P ml-ai &                      # let the first fetch finish
PACE_URL=http://localhost:7453 scripts/brief-demo/run.sh 5
ARMS="search pace search-cold" scripts/brief-demo/run.sh 5
```

It needs `claude` (Claude Code), `jq`, and `bun`. `MODEL` defaults to `claude-sonnet-5`. `BUDGET_USD` (default 15) stops the loop before total spend can pass it. Runs that already have a transcript are skipped, so a rerun only fills gaps.

## Findings (2026-09-27, claude-sonnet-5, 5 runs per arm)

| Mean per run | Input tokens, all models | Main model input | Output tokens | Tool calls | Wall time | Cost |
|--------------|-------------------------:|-----------------:|--------------:|-----------:|----------:|-----:|
| search: web tools, told your sources | 270,327 | 31,980 | 8,576 | 14.6 | 51s | $0.416 |
| pace: same agent, reads `/brief.md` | 21,528 | 20,520 | 1,108 | 1.0 | 15s | $0.033 |
| search-cold: web tools, not told your sources | 35,607 | 8,505 | 2,446 | 2.4 | 24s | $0.083 |

- **Against an agent that covers your sources, Pace is about 12x cheaper and 3x faster, with 15x fewer tool calls.** The search arm made 14-15 calls per run: fetches of the blogs, HN, arXiv and GitHub release pages, or a string of searches for each of them. Pace was one `curl`.
- **The 13x token gap is mostly not the answering model.** Claude Code's `WebFetch` has a small model (Haiku) read each page, which accounts for about 238k of the search arm's 270k input tokens. The answering model saw 1.6x more input with web tools than with the brief. An agent whose fetch tool dumps pages straight into its own context would pay more of the gap at main-model prices. This harness doesn't measure that.
- **The search answers cover more ground, and they are less reliable about "today".** They include releases and posts older than the brief's window. They also present week-old launches (Opus 5.5 and GPT-6 on Sept 22) as today's news, and two runs named different "latest" vLLM releases (v0.30.0 and v0.25.1). The pace answers stop at what the brief contains and say when a section is quiet. Today, a Sunday, most sections were.
- **An agent that doesn't know your sources is cheap, and it answers a different question.** The cold arm ran 2-4 searches, mostly of aggregator sites, and returned general AI news. None of it came from the sources the user follows.
- **Every pace run followed the skill.** Each made exactly one `curl` (`?since=24h`), no web searches, and cited items as `[n]`.
- **The pace arm's fixed prompt grew between days.** The brief the agent read was the same size on both days (~1.4k tokens at `since=24h`). The first-turn prompt (system prompt, skill and tool definitions) measured ~8.9k tokens on 2026-09-27 against ~5.0k on 2026-09-26, on the same Claude Code version (2.1.282). The cause wasn't identified. That's why the pace arm's input rose from 13.8k to 21.5k while its cost stayed at $0.03.

The runs cost $2.66 in total (Claude Code list-price estimate). The 2026-09-26 runs, which had similar results ($0.45 vs $0.03 per run), are in the git history of this directory.
