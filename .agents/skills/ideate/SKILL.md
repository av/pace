---
name: ideate
description: Timeboxed ideation on a topic using propose-and-critique subagent pairs. Use when the user wants to brainstorm, explore ideas, discover features, generate options, or think through possibilities for a specified duration. Triggers on requests like "brainstorm X for 30 minutes", "ideate on X", "spend an hour thinking about X", "what features should we build", "explore options for X".
---

# Ideate

Generate, stress-test, and rank ideas on any topic through iterative propose-and-critique cycles. Each iteration dispatches two subagents: one to propose an idea, one to tear it apart from the end-user perspective. The clock controls when you stop. The critique scores control what survives.

## Your Role

You are the **orchestrator**. You do three things:

1. **Manage the clock** — check time before every dispatch, stop when the deadline passes
2. **Dispatch subagent pairs** — a proposer and a critic, every iteration
3. **Track scores and patterns** — update the progress file, learn what the critic rewards and punishes

You do NOT propose ideas yourself. You do NOT critique ideas yourself. You do NOT do any research, code reading, or analysis. All intellectual work happens inside subagents. Your context is reserved for the dispatch loop and pattern tracking.

## The Iron Law

```
YOU DO NOT DECIDE WHEN IDEATION IS DONE. THE CLOCK DECIDES.
```

Keep dispatching propose-and-critique pairs until the deadline passes. You have zero authority to judge "enough ideas" or "good enough." The user gave you a duration. You use all of it.

## Inputs

The user provides two things:

1. **Topic** — what to ideate on (e.g., "features for our CLI tool", "ways to reduce API latency", "naming options for the new service")
2. **Duration** — how long to ideate (e.g., "30 minutes", "1 hour", "2 hours")

If the duration is vague ("a while"), interpret as 1 hour. If truly ambiguous, ask once.

Optionally, the user may specify:
- **Top N** — how many ideas to present at the end (default: 3)
- **Context** — a codebase, document, or domain to ground proposals in

See .agents/skills/timeboxed-iterating/SKILL.md for the canonical "The Process" (dot-graph + "### Step by step"), "What the Subagent Prompt Looks Like", and guidance for steering/presenting results (Top N Ideas). Ideate specializes the canonical timeboxed process for paired proposer + critic subagent dispatches (per "Your Role"), critic 1-10 scoring, explicit Patterns tracking for steering, dedicated `/tmp/ideate-<slug>-<timestamp>.md` progress file, default Top N=3, and ranked presentation of ideas + discovered patterns at the end.

## Guidance References

See .agents/skills/timeboxed-iterating/SKILL.md for the canonical "Preventing Premature Exit" table and guidance, "Stall Recovery" procedure, "Quick Reference" table and "Red Flags" guidance. The general patterns apply to this skill too.

Ideate-specific traps (additions to Preventing Premature Exit):

- "We have enough good ideas": Check the clock. Time left? Keep going.
- "The top 3 are clearly the winners": Better ideas might emerge. The critic will sort them.
- "All the obvious ideas have been tried": That's when the creative ones start. Push harder.
- "The scores are converging": Try a radically different angle.
- "I should present what we have": Only after the deadline. Not before.
- "The last few scored poorly": Learn from the critic. Steer the proposer differently.

Ideate-specific actions (additions to Stall Recovery, when 3 consecutive scores under 4):

1. **Shift category entirely.** If product features aren't working, try process improvements. If technical ideas are stale, try UX or documentation angles.
2. **Invert the question.** Instead of "what should we add?", ask "what's currently broken?" or "what do users complain about?"
3. **Change the critic's lens.** Ask the critic to evaluate from a different persona (new user vs power user, developer vs manager, human vs AI agent).
4. **Combine previous ideas.** Tell the proposer to take the strongest elements from two mid-scoring ideas and combine them.

If after 3 recovery attempts proposals are still trivial, log it and keep going. Do not stop.

The ideate-specific details (propose/critic dispatch, Patterns tracking, progress file naming `/tmp/ideate-<slug>-...`, default top N=3, stall threshold of 3 consecutive <4, red flags for presenting with time left or self-proposing/critiquing) are described in "Your Role", "Inputs", "Iron Law" and the ideate-specific traps/actions above.
