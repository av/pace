---
name: bugbash
description: Systematically explore and test any software project (CLI, API, Backend, Library, etc.) to find bugs, usability issues, and edge cases. Produces a structured report with full reproduction evidence (exact commands, inputs, logs, and tracebacks) for every issue.
---

# Bugbash (General Software)

Systematically explore a software project, find issues, and produce a report with full reproduction evidence for every finding. This skill applies to CLIs, APIs, Backends, Libraries, and other non-web interfaces.

## Setup

Identify the **Target** (e.g., a CLI binary, an API base URL, a Python package).

| Parameter | Default | Example override |
|-----------|---------|-----------------|
| **Target** | _(required)_ | `./my-cli`, `http://localhost:8080`, `import mylib` |
| **Output directory** | `/tmp/dogfood-output/` | `Output directory: ./qa-reports` |
| **Scope** | Full project | `Focus on the auth middleware` |

## Process

Lightweight exploration flow (no rigid 5-phase orchestration, no quotas, no 5-item capture lists):

### 1. Initialize

```bash
mkdir -p {OUTPUT_DIR}/logs {OUTPUT_DIR}/evidence
```

Create a `report.md` in the output directory and fill in the header fields. Include:
- Target
- Date
- Environment Details (OS, language version)
- Summary Counts (Critical, High, Medium, Low)

If the software needs to be built or started (e.g., `npm run build`, `docker-compose up -d`, `cargo build`), do that now. Keep track of the startup logs and run servers in the background if necessary (e.g., using `&` and redirecting output for commands that do not support detached mode).

Orient by mapping the surface area of the software before testing (for CLIs: `{TARGET} --help` + subcommands + envs; for APIs: schemas/routes; for libs: exports). Save to `{OUTPUT_DIR}/surface-area.txt`.

Explore the surface systematically: happy paths, invalid inputs, missing context, boundary conditions. At each step capture stdout, stderr, exit codes, HTTP status.

Document issues *as you find them* (do not batch at end). Every issue needs full repro evidence for a reader to copy-paste and reproduce: description, severity (Critical/High/Medium/Low), exact repro steps/commands, expected vs actual behavior, and evidence (stdout/stderr, traces, logs, exit codes). Save verbose evidence files to `{OUTPUT_DIR}/evidence/issue-{NNN}.txt` and reference in report; embed short ones in markdown.

Wrap up: re-read and sync the report's summary severity counts to the actual documented issues; stop any background processes started in init; tell the user the report is ready with totals, breakdown, and top critical items.

## Guidance

- **Repro is everything.** Every issue needs proof. Provide the exact `curl` command, CLI invocation, or script used to trigger the bug. A reader should be able to copy-paste the commands to see the exact same failure.
- **Verify reproducibility.** Before documenting an issue, verify it is reproducible with at least one retry. If it's flaky, note that and try to identify the conditions.
- **Capture the environment state.** Often bugs depend on the environment (files present, variables set). Note `pwd`, env vars, or local files if they are part of the repro.
- **Write findings incrementally.** Append each issue to the report as you discover it. If the session is interrupted, findings are preserved. Never batch all issues for the end.
- **Don't just look for crashes.** Usability matters. Confusing error messages, undocumented required flags, and sluggish performance are all valid issues.
- **Test like a user, not a robot.** Try common workflows end-to-end. Combine flags or API calls in ways a real user would, passing the output of one command as input to the next.
- **Check the exit codes and status codes.** A CLI returning `0` on failure, or an API returning `200 OK` for an error payload, is a bug. `echo $?` or `curl -w "%{http_code}"` are your friends.
