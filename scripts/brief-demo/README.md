# Brief demo: the same question with and without Pace

`run.sh` asks one headless agent "What's new in ML/AI today that matters to me?" in three ways and records every run. `summarize.ts` turns the transcripts into [results.md](results.md): the full per-run table, the method, and every answer.

```bash
pace serve -P ml-ai &                      # let the first fetch finish
PACE_URL=http://localhost:7453 scripts/brief-demo/run.sh 5
ARMS="search pace search-cold" scripts/brief-demo/run.sh 5
```

It needs `claude` (Claude Code), `jq`, and `bun`. `MODEL` defaults to `claude-sonnet-5`. `BUDGET_USD` (default 15) stops the loop before total spend can pass it. Runs that already have a transcript are skipped, so a rerun only fills gaps.

## Findings (2026-09-26, claude-sonnet-5, 5 runs per arm)

| Mean per run | Input tokens, all models | Main model input | Output tokens | Tool calls | Wall time | Cost |
|--------------|-------------------------:|-----------------:|--------------:|-----------:|----------:|-----:|
| search: web tools, told your sources | 343,112 | 24,821 | 10,523 | 16.0 | 47s | $0.446 |
| pace: same agent, reads `/brief.md` | 13,799 | 12,791 | 1,416 | 1.0 | 11s | $0.033 |
| search-cold: web tools, not told your sources | 79,539 | 13,778 | 4,870 | 5.6 | 36s | $0.158 |

- **Against an agent that covers your sources, Pace is about 13x cheaper and 4x faster, with 16x fewer tool calls.** The search arm fetched 14-20 pages per run: every blog, the HN front page, Lemmy, arXiv listings, and six GitHub release pages. Pace was one `curl`.
- **The 25x token gap is mostly not the main model.** Claude Code's `WebFetch` has a small model (Haiku) read each page, and that accounts for about 318k of the search arm's 343k input tokens. The answering model saw 1.9x more input with web tools than with the brief. An agent whose fetch tool dumps pages straight into the main context would pay the full gap at main-model prices. This harness didn't measure that.
- **The search answers were not worse.** They covered things the brief leaves out on purpose: releases older than the 72h window (vLLM, transformers, PyTorch) and posts from blogs with nothing new. They also hit real friction: CNBC blocked the fetch, one Lemmy instance was empty, and GitHub dates were misread. Pace answers stop at what the brief contains, and they say so ("the brief has only the headline").
- **An agent that doesn't know your sources is cheaper than one that does, and it answers a different question.** The cold arm ran 3-4 searches and 2-3 fetches of news aggregators, and it came back with general AI news: model launches from tracker sites, some flagged by the agent itself as conflicting. None of it came from the sources the user follows.
- **Every pace run followed the skill.** Each made exactly one `curl` (`?since=24h` in all five), no web searches, and cited items as `[n]`. A separate run where Claude Code found the installed skill on its own (`transcripts/skill-native-discovery.jsonl`) did the same: one Skill load, one `curl`, 11.5s, $0.07.
- **The brief is ~3.2k tokens as Markdown** (33 items from 7 panels at the default 72h window). The pace arm's ~12.8k input is mostly the system prompt plus the skill text.

The runs cost $3.26 in total (Claude Code list-price estimate), including one smoke run and the native-discovery run.
