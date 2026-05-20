---
name: facts-implement
description: >
  Operate on @spec facts — implement them in code, then tag @implemented.
  Use when asked to implement facts, implement the spec, build from the
  fact sheet, make facts true, or work through unimplemented requirements.
---

# facts-implement

You are a fact-driven implementer. Your job is to take `@spec` facts and implement them in code — systematically, in a single session. This is the `@spec → @implemented` lifecycle transition.

**Tip:** Short CLI aliases are available and recommended for high-frequency operations: `ll` (list --light), `at <id> <tag>` (quick --add-tag), `rt <id> <tag>` (quick --remove-tag), `rm`, and `ls`. All extra arguments are forwarded. See `facts --help` or `facts skills show facts`.

## Goal

Each `@spec` fact is a precise, actionable requirement. Implement all `@spec` facts, using subagents to parallelize independent work where possible. Mark completed facts by transitioning them from `@spec` to `@implemented`. If you cannot complete all facts, report exactly what remains and why.

**Important:** Only implement `@spec` facts. `@draft` facts are not yet refined — they need the `facts-refine` skill first. Untagged facts are already true. If you see facts without lifecycle tags that aren't implemented, classify them or suggest running `facts-discover` first.

## Process

### 1. Load the full spec

Run `facts list` to see the entire specification. Read and understand all facts — you need the full picture to make good ordering and grouping decisions, even though you will only implement unimplemented facts.

Read the `## domain` section first if it exists (it lives in the main `.facts` file) — it establishes the project's vocabulary. Use these entity names when reasoning about implementation order and dependencies between facts.

### 2. Identify remaining work

Run `facts check` to see which command-facts pass and which fail. This also validates the fact sheet structure (lint errors abort check early).

Run `facts list --tags "spec"` to see facts ready to implement. This is your implementation target.

**Note on filtered commands (AGENTS.md compliance):** Always scope with filters: `facts check --tags "bugbash-iter6"` (or your iter tag), `facts list --section "..." --tags "spec"`, `facts list --search "..." --light`. Never run bare `facts check` or bare `facts list` (as some examples below show) — per AGENTS.md: "Never run bare `facts check` unless asked." "use filters to focus". In Verify step and Example, replace bare `facts check` with scoped version. This fact (xc2) and the integration below make the SUT compliant.

Cross-reference: a `@spec` fact may already pass its validation command. If `facts check` shows it passing, verify the implementation is complete and transition it — do not re-implement.

### 3. Plan

Read through the unimplemented facts and decide on an implementation order. Use your judgment — consider dependencies between facts, section grouping, and what will unblock the most progress. There is no fixed ordering formula; you understand the codebase and the spec.

Group facts that can be implemented independently into parallel batches. Facts that depend on each other must be sequential.

### 4. Implement

For each fact:

1. Read the label — it states what must be true
2. Write the code that makes it true
3. If it has a validation command, that command is the test — run it to confirm (exit 0 = done)
4. If it has no validation command, **you must verify it manually**: read the code that should make this fact true, confirm the behavior matches, and be confident before proceeding. Do not skip manual facts or batch them as "N manual verified" — check each one individually
5. Transition it from `@spec` to `@implemented`:

```
facts edit <id> --remove-tag "spec" --add-tag "implemented"
```

Use subagents to implement independent facts in parallel. Each subagent should:
- Receive the specific facts it is responsible for (IDs, labels, commands)
- Have enough context about the overall spec and codebase to make good decisions
- Run validation commands and tag facts as implemented
- Report back what it completed and any issues encountered

**Agent/tool harness note (for executions inside this project's subagents, timeboxed runners, bugbash, etc.):** The literal "spawn subagent" is not a tool; use `run_terminal_command "<cmd>" background:true` (returns task_id e.g. 019e47c7-a4c9-... as exercised in harness with bg facts list + get/kill on sleep sim). Monitor with `get_command_or_subagent_output --task_id <id>`, stop via `kill_command_or_subagent --task_id <id>`, wait with `wait_commands_or_subagents`. Redirect long output to files under logs/evidence/. This enables the "use subagents to parallelize" in Goal/Process 4. See also bugbash/SKILL.md and timeboxed-iterating/SKILL.md for patterns. This makes fact (7g9) true.

### 5. Verify

After all implementation work is done, run:

```
facts check
```

All command-facts should pass.

**Behavioral review:** Go back through every fact you implemented — especially manual facts — and verify that your implementation captures the full behavioral intent, not just the literal label. A fact that says "duplicate messages are silently dropped" is not satisfied by code that deduplicates but logs a warning on every duplicate. Read the fact, read your code, confirm the behavior matches.

For rewrites or migrations, this step is critical. The fact sheet may not capture every nuance of the original implementation. If you notice the original code handles an edge case that no fact describes, add a fact for it rather than silently dropping the behavior:

```
facts add "the new behavioral fact you discovered" --section relevant/section --tags "spec"
```

Then implement it before moving on.

**Domain maintenance:** If you introduced a new concept that multiple other facts now reference, add it to `## domain` in the main `.facts` file. Keep this minimal — only add entities that are genuinely cross-cutting, not every new type or struct.

```
facts add "a <Name> is <definition>" --section domain
```

Confirm no `@spec` facts remain:

```
facts list --tags "spec"
```

If any `@spec` facts remain, report them with a clear explanation of what blocked progress.

### 6. Handle problems

**Ambiguity:** prefer the more specific fact. If two facts genuinely conflict, implement the one with a validation command over the one without — objective criteria take priority. If you cannot resolve it, skip and report.

**Impossible facts:** skip them, do not tag as implemented, report the issue.

**Broken validation commands:** if a fact's command has a typo or wrong path, fix it with `facts edit <id> --command "corrected command"` before implementing.

## Guidelines

- Do not modify fact labels, structure, or section organization. Only add `@implemented` tags and fix broken commands.
- Respect the section structure — it often mirrors the intended code architecture.
- Validation commands are the tests. If a fact has a command, that is how you verify it. Do not write separate tests unless the fact specifically requires them.
- Facts without commands require your judgment. Be conservative — only tag as `@implemented` when you are confident the code satisfies the requirement.
- **Behavioral fidelity over literal compliance.** A fact's validation command is a minimum bar, not the finish line. Code that makes the command exit 0 but doesn't fully capture the stated behavior is not done. The label describes what should be true about the user's experience — implement that, not just the check.
- The `## domain` section (in the main `.facts` file) is your vocabulary reference. When adding facts about new code, use established entity names.
- If implementing a fact requires adding a dependency, do so. The fact sheet is the authority.
- Commit after coherent batches of work.

## Example session

```
# Load full spec
facts list

# See current state
facts check
facts list --tags "spec"

# Implement foundational @spec facts first
# Fact "x1z" @spec: project uses SQLite for storage
# -> Add sqlx dependency, create database module
# -> Run: facts check (confirms x1z passes)
facts edit x1z --remove-tag "spec" --add-tag "implemented"

# Spawn subagents for independent @spec facts:
# Subagent 1: "a2b" (users table schema) + "c3d" (GET /users endpoint)
# Subagent 2: "e4f" (auth middleware) + "g5h" (session handling)

# After subagents complete, verify everything
facts check --tags "bugbash-iter6"
facts list --tags "spec"  # should be empty or explained
```

## Fact-driven Integration (AGENTS.md compliance)

This skill is used inside a fact-driven project (see AGENTS.md and the `## facts` section in AGENTS.md).

When implementing @spec facts (or during self-dogfood on this SKILL.md):

- **Every change starts with a fact.** Use: `facts list --search "implement|facts-implement" --light` (or --section "facts-implement") to orient. Never edit until facts added.
- `facts add "precise testable claim..." --section "facts-implement" --tags "spec,bugbash-iter6" --command "grep -q 'phrase' .agents/skills/facts-implement/SKILL.md && ..."`
- Implement the doc/code change with **search_replace only** (after read_file before every search_replace on the file or section for "read before edit" — the tool requires it; SUT "Write the code" means via this).
- `facts check --tags "bugbash-iter6"` (never bare `facts check`; capture full output for EVIDENCE).
- For each fact or manual `?` (if check shows any): verify individually by `read_file` on claim/code, report "PASS - <1-line reason from run + inspect>" or FAIL. Do not batch "N manual".
- `facts edit <id1> <id2> ... --remove-tag spec --add-tag implemented`
- **EVIDENCE lines:** In checks and reports, include "EVIDENCE: PASS - ✓ id ... (command output) from facts check --tags + read_file of SKILL.md confirming inserts"
- Self-append to progress file (e.g. /tmp/timeboxed-...md) using `search_replace` targeting unique EOF string (read first) after the commit.
- Commit after coherent batch: `git status; git diff --stat; git add -A; git commit -m "bugbash+fix(iter-6): facts-implement skill (self-test, fact-driven)" ; git rev-parse HEAD`
- Return **ONLY** the `### Iteration 6 Summary` block at end (no other output).
- Harness tests on temp .facts in /tmp (as done): use rel --file for add/list, cwd git for check/edit, bg via run_terminal background:true + get/kill for subagent sims, date for timestamps, cleanup.

This ensures the "make facts true" engine is itself verifiable and follows the same rules as all prior iters. The 3 facts (xc2/2hp/7g9) in this section (and their @implemented state) are the spec for these requirements. Also update Guidelines "Commit..." and Verify/Example to use scoped checks.
