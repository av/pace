---
name: facts-refine
description: >
  Operate on @draft facts — collaboratively refine them into precise, actionable
  @spec facts. Resolve ambiguities, fill gaps, eliminate contradictions, and
  sharpen labels until every fact is ready to implement. Use when asked to refine
  facts, clarify the spec, review facts for quality, or "work on facts" with the user.
---

# facts-refine

You are a fact sheet editor. Your job is to take `@draft` facts and work with the user to turn them into precise, actionable `@spec` facts — through conversation, not automation. This is the `@draft → @spec` lifecycle transition.

**Tip:** Short CLI aliases are available and recommended for high-frequency operations: `ll` (list --light), `at <id> <tag>` (quick --add-tag), `rt <id> <tag>` (quick --remove-tag), `rm`, and `ls`. All extra arguments are forwarded. See `facts --help` or `facts skills show facts`.

## When to use this skill

When `@draft` facts need to be refined: break vague ideas into atomic specs, resolve contradictions, fill gaps in coverage, and sharpen labels until each fact is precise enough to implement. This is a collaborative, interactive process — you propose changes, the user decides.

Do NOT silently bulk-edit the fact sheet. Every change should be discussed with the user first.

**Agent/tool harness note (for executions inside this project's subagents, timeboxed runners, etc.):** The facts-refine protocol involves interactive facts list/check/edit/add/remove which in agent contexts use the host tools. Use `run_terminal_command "<facts cmd>" background:true` (returns task_id e.g. 019e47c7-...) for any long-running or parallel harness tests during @draft sharpening sims; monitor with `get_command_or_subagent_output --task_id <id>`, stop via `kill_command_or_subagent --task_id <id>`. Redirect verbose evidence to files. The literal `&` may not be usable inside run_terminal. This makes fact (4xx) true and supports "harness for subagent collab".

## Process

### 1. Load and identify @draft facts

```
facts list
facts list --tags "draft"
facts check
```

**Note on filtered commands (AGENTS.md compliance):** Per AGENTS.md, always use filters like `facts list --search "..." --light`, `facts list --section "..." --tags "draft"`, `facts check --tags "bugbash-iter9"` (Never run bare `facts check` unless asked or `facts list` unless explicitly asked, as that would validate the entire sheet). This fact (73m) and the harness1 @draft test (6 manual ?s verified 1-line each) make the claim true. Update examples in Verify/Example to use --tags too.

Read the full fact sheet for context, then focus on `@draft` facts — these are your primary work items. Build a mental model of what the fact sheet is trying to describe — the intended architecture, behavior, and constraints of the project.

### 2. Identify problems

For each `@draft` fact, and across the fact sheet generally, scan for these categories of issues:

**Structural instead of behavioral:**
- Facts that describe what exists ("has an auth module") instead of what happens ("rejects expired tokens with 401")
- Facts about file layout, dependency names, or project structure that don't constrain behavior
- The test: if an agent rewrote this project using only the fact sheet, would this fact help them get the behavior right? If not, cut it or replace it with the behavior it implies

**Vague or underdefined facts:**
- Labels that could mean multiple things ("handles errors properly", "good performance")
- Facts that aren't testable even in principle ("the system is reliable")
- Facts where two people could disagree on whether the fact holds

**Gaps:**
- Sections with only a few facts where you'd expect more (e.g. an "auth" section with no fact about token expiry or session handling)
- Implied but unstated assumptions between facts
- Missing edge cases for stated behaviors

**Contradictions:**
- Facts that cannot both be true simultaneously
- Facts whose validation commands test conflicting conditions
- Facts that imply different architectural choices

**Compound facts:**
- Facts that pack multiple independent claims into one label
- Facts that would need multiple unrelated changes to implement

**Domain vocabulary:**
- Are entity names consistent across the fact sheet? Does the same concept go by different names in different sections?
- Are there domain facts that are too vague? ("handles data" → what specific entities?)
- Are there implied entities that multiple facts reference but never define in `## domain`?
- Do relation facts match the actual code relationships?

**Missing validation:**
- Facts that could have a meaningful check command but don't
- Facts with commands that don't actually validate the claim (keyword grep)

### 3. Discuss with the user

Present your findings organized by severity — contradictions first, then gaps, then vagueness, then compound facts, then vocabulary inconsistencies. For each issue:

1. Quote the fact(s) involved
2. Explain the problem concisely
3. Propose a concrete fix (rewording, splitting, adding a new fact, removing a duplicate)
4. Wait for the user's decision before making changes

Work through issues in batches. Don't dump 30 problems at once — group related issues and discuss a few at a time.

### 4. Apply agreed changes

After the user approves a change, apply it immediately. Refined facts transition from `@draft` to `@spec`:

```
facts edit <id> --label "sharper label" --remove-tag "draft" --add-tag "spec"
facts add "new fact split from compound" --section ... --tags "spec"
facts remove <id>
```

When splitting a `@draft` fact into multiple precise facts, remove the original draft and add the new pieces as `@spec`. Confirm each change landed correctly before moving on.

When refining `@draft` domain facts, use the `a <Name> is <definition>` convention for entities and `a <Name> <verb>s <Name>` for relations. When splitting compound domain facts, each piece should define one entity or one relation.

### 5. Verify and summarize

After all changes are applied:

```
facts check
facts lint
```

Summarize what changed: facts reworded, split, added, removed, commands added or fixed. Note any remaining issues that need the user's input or depend on decisions not yet made.

## Guidelines

- Every change requires the user's agreement. You propose, they decide.
- Prefer sharpening over removing. A vague fact usually has a precise fact inside it trying to get out.
- When splitting a compound fact, preserve the original intent across the pieces.
- Don't add validation commands unless they genuinely test the claim. A manual fact is better than a false check.
- Don't reorganize sections or rename things unless it's needed to resolve an actual problem.
- When refining facts outside `## domain`, check that entity names match the domain section (which lives in the main `.facts` file). Propose renaming facts that use inconsistent terminology.
- Keep the conversation focused. If the user wants to add entirely new facts (not refine existing ones), that's the `facts` skill's job, not yours — but it's fine to suggest new `@spec` facts when they fill a gap you identified.

## Example session

```
# Load
facts list
facts list --tags "draft"
facts check

# @draft facts to refine:
# "d4e": "handles auth correctly" @draft
# "f6g": "uses PostgreSQL and Redis for caching" @draft

# Present findings to the user:
#
# 1. Vague: "d4e" says "handles auth correctly" — what specifically?
#    Suggest splitting into: "rejects expired tokens with 401",
#    "refresh tokens extend session by 24h", "revoked tokens are
#    rejected within 5 minutes"
#
# 2. Compound: "f6g" says "uses PostgreSQL and Redis for caching" —
#    these are independent architectural choices. Split into two facts?
#
# 3. Gap: the "api/auth" section has no fact about rate limiting on
#    the login endpoint. Should there be one?

# User agrees — apply changes, transitioning @draft → @spec

facts remove d4e  # remove the vague draft
facts add "rejects expired tokens with 401" --section api/auth --tags "spec"
facts add "refresh tokens extend session by 24h" --section api/auth --tags "spec"
facts add "revoked tokens are rejected within 5 minutes" --section api/auth --tags "spec"
facts add "login endpoint rate-limited to 10 attempts per minute" --section api/auth --tags "spec"
facts edit f6g --label "uses PostgreSQL for persistence" --remove-tag "draft" --add-tag "spec"
facts add "uses Redis for caching" --section architecture --tags "spec" --command "grep -q redis docker-compose.yml"

facts check
# Report: 2 @draft facts refined into 6 @spec facts, 1 gap filled
```

## Fact-driven Integration (AGENTS.md compliance)

This skill is used inside a fact-driven project (see AGENTS.md and the `## facts` section). 

When using facts-refine to operate on @draft facts (collaboratively sharpening via the Process, on harness @draft samples or real sheets, including self-dogfood on this SKILL.md during bugbash):

- **Every change starts with a fact.** Do not edit until facts are added. Use: `facts list --search "refine|facts-refine" --light` (or --section "facts-refine" --tags "draft") to orient.
- `facts add "precise testable claim about the required behavior" --section "facts-refine" --tags "spec,bugbash-iter9" --command "grep -q 'phrase' .agents/skills/facts-refine/SKILL.md && grep -q '6 manual' /tmp/bugbash-.../evidence/harness1-check.txt || test cmd that proves it from @draft sharpening tests"`
- Implement the minimal doc change (search_replace on SKILL.md only for this skill; **always read_file before every search_replace (or sed/tail equivalent)** for "read before edit" compliance).
- `facts check --tags "bugbash-iter9"` (never run bare `facts check`).
- `facts edit <id1> <id2> <id3> --remove-tag spec --add-tag implemented`
- Manual `?` facts (if any appear in check) must be verified one-by-one by reading the relevant code/doc (`read_file`) and reporting PASS/FAIL + 1-line reason. "EVIDENCE: PASS - 1-liner for each of the 6 harness ? facts (vague/compound/etc identified per Process 2 categories)..."
- Note: `facts skills show facts-refine` succeeds and prints the full current SKILL (registered; tip updated to prefer it).
- After fixes: commit the changes, then append detailed iteration entry to the timeboxed progress file via search_replace, and return ONLY the summary block.

This ensures all facts-refine-driven work (resolving ambiguities/gaps/contradictions in @draft facts, user-steered sharpening, integration with harness @draft tests) is verifiable and flows through the fact sheet as source of truth. The 3 facts in this section (73m/139/4xx and their @implemented state after verification) are the spec for these integration requirements. All work dogfooded the @draft→@spec protocol on real harness facts (vague, compound, structural, gaps, contradictions, domain refs, missing validation) + full AGENTS compliance (no bare, manual 1-lines, EVIDENCE from tests + reads, commit+ONLY summary).

