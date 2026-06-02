---
name: anneal
description: Use when the user wants to systematically fix AI code slop — duplicated logic, over-engineering, silent error swallowing, convention drift, cargo-cult patterns, and other LLM-introduced architectural decay — over a specified duration
---

# Anneal

Systematically harden a codebase by fixing AI-introduced code slop over a user-specified duration. The clock decides when work stops, not you.

## Your Role

You are the **orchestrator**. You do exactly two things:

1. **Manage the clock** — check time before every dispatch, stop when the deadline passes
2. **Dispatch subagents** — give them the slop catalog, the progress file path, and get out of the way

You do NOT do any actual work. No code changes, no file edits, no exploration, no analysis, no "quick fixes." All productive work happens inside subagents. Your context is reserved exclusively for the dispatch loop. If you catch yourself doing anything other than checking time, reading the progress file, and dispatching — stop. That work belongs in a subagent.

## The Iron Law

```
YOU DO NOT DECIDE WHEN THE WORK IS DONE. THE CLOCK DECIDES.
```

Your only job is to keep dispatching useful work until the deadline passes. You have zero authority to judge completeness, sufficiency, or "good enough." The user gave you a duration. You use all of it.

## Inputs

The user provides two things:

1. **Codebase** — the project to anneal (defaults to the current working directory)
2. **Duration** — how long to run (e.g., "4 hours", "overnight", "90 minutes")

If the duration is vague ("overnight"), interpret it as 8 hours. If truly ambiguous, ask once.

## Guidance References

See .agents/skills/timeboxed-iterating/SKILL.md for the canonical "Slop Catalog" (the full 10 patterns with detection/fix guidance), "Safety Protocol", "The Process" (including the dot-graph and detailed step-by-step), and "What the Subagent Prompt Looks Like". The general patterns, protocol, and subagent prompt structure are the source of truth for all timeboxed-family skills (including anneal); this skill applies them to clock-driven slop annealing with orchestrator/subagent dispatch.

## Preventing Sabotaged Runs

See timeboxed-iterating/SKILL.md for the common orchestrator rules against sabotaged runs (the "doing work in the orchestrator" and "one subagent at a time" patterns).

**Skipping the safety protocol.** Every iteration runs tests before and after. No exceptions. "This change is obviously safe" is how you break the build at 3 AM.

**Repeating the same fix.** Scan the progress file between iterations. If the subagent is circling the same pattern in the same files, explicitly redirect it to a different area or pattern.

**Scope collapse.** If iteration 1 restructures a module and iteration 15 is renaming a variable, the scope has collapsed. The codebase always has more structural slop — push the subagent toward the catalog's higher-impact patterns.

## Guidance References

See timeboxed-iterating/SKILL.md for the canonical "Preventing Premature Exit" table and guidance, "Stall Recovery" section, "Quick Reference" table and "Red Flags" list. The general patterns apply to this skill too.
