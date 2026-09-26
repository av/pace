#!/usr/bin/env bash
# Token demo: the same question, the same model, two ways.
#   search: an agent with WebSearch/WebFetch and no Pace
#   pace:   the same agent and tools, plus curl and the pace-brief skill,
#           reading a running Pace ml-ai brief
#   search-cold (opt-in via ARMS): the search arm without the user's source
#           list, i.e. an agent that doesn't know what you follow
# Each run is a headless Claude Code session with a fixed system prompt, no
# user settings, no MCP servers and no project files. Transcripts land in
# transcripts/<arm>-<n>.jsonl; summarize.ts turns them into results.md.
#
# Usage: scripts/brief-demo/run.sh [runs-per-arm]
# Env:   PACE_URL (default http://localhost:7453), MODEL (default
#        claude-sonnet-5), BUDGET_USD total cap (default 15),
#        RUN_BUDGET_USD per-run cap (default 3), ARMS (default "search pace")
set -euo pipefail
# Bash 5.2 expands "&" in ${var//pat/rep} replacements; the skill text has them.
shopt -u patsub_replacement 2>/dev/null || true

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
runs="${1:-3}"
pace_url="${PACE_URL:-http://localhost:7453}"
model="${MODEL:-claude-sonnet-5}"
budget="${BUDGET_USD:-15}"
run_budget="${RUN_BUDGET_USD:-3}"
arms="${ARMS:-search pace}"
out="$here/transcripts"
mkdir -p "$out"

curl -sf "$pace_url/health" >/dev/null || { echo "brief-demo: no pace server at $pace_url" >&2; exit 1; }

today="$(date -u +%Y-%m-%d)"
question="$(cat "$here/question.txt")"
system="$(sed "s/{{DATE}}/$today/" "$here/system.txt")"
skill="$(cat "$repo/skills/pace-brief/SKILL.md")"
pace_extra="$(cat "$here/pace-arm.txt")"
pace_extra="${pace_extra//\{\{PACE_URL\}\}/$pace_url}"
pace_extra="${pace_extra//\{\{SKILL\}\}/$skill}"
pace_extra="${pace_extra//localhost:7453/${pace_url#http://}}"

# An empty working directory: no CLAUDE.md/AGENTS.md or repo files to read.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

spent() {
  # Sum total_cost_usd over finished transcripts.
  local files=("$out"/*.jsonl)
  [ -e "${files[0]}" ] || { echo 0; return; }
  cat "${files[@]}" | jq -rs '[.[] | select(.type == "result") | .total_cost_usd // 0] | add // 0'
}

run_arm() {
  local arm="$1" n="$2" file="$out/$1-$2.jsonl"
  local tools sys
  local -a allowed
  local prompt="$question"
  if [ "$arm" = search ]; then
    tools="WebSearch,WebFetch"; allowed=(WebSearch WebFetch); sys="$system"
  elif [ "$arm" = search-cold ]; then
    tools="WebSearch,WebFetch"; allowed=(WebSearch WebFetch); sys="$system"
    prompt="$(head -n 1 "$here/question.txt")"
  else
    tools="Bash,WebSearch,WebFetch"; allowed=("Bash(curl:*)" WebSearch WebFetch); sys="$system$pace_extra"
  fi
  echo "brief-demo: $arm run $n ($model)" >&2
  (cd "$work" && claude -p "$prompt" \
    --model "$model" \
    --system-prompt "$sys" \
    --tools "$tools" \
    --allowedTools "${allowed[@]}" \
    --setting-sources "" \
    --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
    --no-session-persistence \
    --max-budget-usd "$run_budget" \
    --output-format stream-json --verbose) > "$file" || true
}

for n in $(seq 1 "$runs"); do
  # Alternate arms so both see the same news cycle and API conditions.
  for arm in $arms; do
    [ -s "$out/$arm-$n.jsonl" ] && continue
    total="$(spent)"
    if awk -v t="$total" -v b="$budget" -v r="$run_budget" 'BEGIN { exit !(t + r > b) }'; then
      echo "brief-demo: stopping, \$$total spent and the next run could pass \$$budget" >&2
      break 2
    fi
    run_arm "$arm" "$n"
  done
done

echo "brief-demo: spent \$$(spent)" >&2
bun "$here/summarize.ts" "$out" > "$here/results.md"
echo "brief-demo: wrote $here/results.md" >&2
