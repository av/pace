// Summarize brief-demo transcripts (Claude Code stream-json) into a Markdown
// results table: tokens, tool calls, wall time and cost per run, plus means.
// Usage: bun scripts/brief-demo/summarize.ts <transcripts-dir>
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
};

interface Run {
  arm: string;
  n: number;
  model: string;
  input: number;
  mainInput: number;
  cacheRead: number;
  output: number;
  tools: Record<string, number>;
  toolCalls: number;
  turns: number;
  seconds: number;
  cost: number;
  answer: string;
  error: string | null;
}

const dir = process.argv[2] ?? join(import.meta.dir, "transcripts");

function parseRun(file: string): Run | null {
  const m = /^(search-cold|search|pace)-(\d+)\.jsonl$/.exec(file);
  if (!m) return null;
  const lines = readFileSync(join(dir, file), "utf-8").split("\n").filter(Boolean);
  const events = lines.flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const tools: Record<string, number> = {};
  let model = "";
  for (const e of events) {
    if (e.type === "system" && e.subtype === "init") model = e.model ?? model;
    if (e.type !== "assistant") continue;
    for (const block of e.message?.content ?? []) {
      if (block.type === "tool_use" || block.type === "server_tool_use") {
        tools[block.name] = (tools[block.name] ?? 0) + 1;
      }
    }
  }
  const result = events.findLast((e) => e.type === "result");
  const usage: Record<string, ModelUsage> = result?.modelUsage ?? {};
  const sum = (key: keyof ModelUsage) =>
    Object.values(usage).reduce((acc, u) => acc + (u[key] ?? 0), 0);
  const main = usage[model] ?? {};
  const mainInput =
    (main.inputTokens ?? 0) + (main.cacheReadInputTokens ?? 0) + (main.cacheCreationInputTokens ?? 0);
  return {
    arm: m[1]!,
    n: Number(m[2]),
    model,
    // Every token sent to any model in the session (main loop plus the small
    // models WebSearch/WebFetch call), cached or not.
    input: sum("inputTokens") + sum("cacheReadInputTokens") + sum("cacheCreationInputTokens"),
    mainInput,
    cacheRead: sum("cacheReadInputTokens"),
    output: sum("outputTokens"),
    tools,
    toolCalls: Object.values(tools).reduce((a, b) => a + b, 0),
    turns: result?.num_turns ?? 0,
    seconds: (result?.duration_ms ?? 0) / 1000,
    cost: result?.total_cost_usd ?? 0,
    answer: typeof result?.result === "string" ? result.result : "",
    error: result ? (result.is_error ? String(result.subtype ?? "error") : null) : "no result event",
  };
}

const runs = readdirSync(dir)
  .map(parseRun)
  .filter((r): r is Run => r !== null)
  .sort((a, b) => a.arm.localeCompare(b.arm) || a.n - b.n);

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const toolList = (t: Record<string, number>) =>
  Object.entries(t).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const lines: string[] = [];
lines.push(`# Brief demo results

Question (both arms, verbatim from \`question.txt\`): "What's new in ML/AI today that matters to me?" plus one line listing the sources the user follows (the same sources the \`ml-ai\` preset reads).

- **search**: headless Claude Code with \`WebSearch\` and \`WebFetch\`, the system prompt in \`system.txt\`, no Pace.
- **pace**: the same agent, model, system prompt and tools, plus \`curl\` and the \`pace-brief\` skill appended to the system prompt, reading a live \`pace serve -P ml-ai\`.
- **search-cold**: the search arm without the source list (only the first line of the question), i.e. an agent that doesn't know what you follow.

Every run starts clean: empty working directory, no user settings, no MCP servers, no session persistence. Arms alternate within each round so they see the same news cycle. Numbers come from each transcript's final \`result\` event (\`modelUsage\`, \`total_cost_usd\`, \`duration_ms\`); tool calls are counted from \`tool_use\` blocks.

"Input tokens, all models" counts every token sent to any model in the session, cached or not, including the small model Claude Code's \`WebFetch\` uses to read each page. "Main model input" is only what the answering model saw. Cost is Claude Code's list-price estimate. Not measured: answer quality. The answers are below so you can judge them.
`);
lines.push("| Arm | Run | Input tokens, all models | Main model input | Output tokens | Tool calls | Turns | Wall time | Cost |");
lines.push("|-----|-----|-------------------------:|-----------------:|--------------:|------------|------:|----------:|-----:|");
for (const r of runs) {
  lines.push(
    `| ${r.arm} | ${r.n}${r.error ? ` (${r.error})` : ""} | ${fmt(r.input)} | ${fmt(r.mainInput)} | ${fmt(r.output)} | ${r.toolCalls} (${toolList(r.tools)}) | ${r.turns} | ${r.seconds.toFixed(0)}s | $${r.cost.toFixed(3)} |`,
  );
}

const arms = ["search", "pace", "search-cold"].filter((arm) => runs.some((r) => r.arm === arm)).map((arm) => {
  // Runs that never produced a result event (killed, crashed) have no usage
  // numbers; they stay in the per-run table but not in the means.
  const rs = runs.filter((r) => r.arm === arm && r.error !== "no result event");
  return {
    arm,
    runs: rs.length,
    input: mean(rs.map((r) => r.input)),
    mainInput: mean(rs.map((r) => r.mainInput)),
    output: mean(rs.map((r) => r.output)),
    tools: mean(rs.map((r) => r.toolCalls)),
    seconds: mean(rs.map((r) => r.seconds)),
    cost: mean(rs.map((r) => r.cost)),
    total: rs.reduce((a, r) => a + r.cost, 0),
  };
});
const armStats = (name: string) => arms.find((a) => a.arm === name) ?? { arm: name, runs: 0, input: 0, mainInput: 0, output: 0, tools: 0, seconds: 0, cost: 0, total: 0 };
const search = armStats("search");
const pace = armStats("pace");
const cold = armStats("search-cold");
const ratio = (a: number, b: number) => (b > 0 ? `${(a / b).toFixed(1)}x` : "n/a");

lines.push("");
lines.push("| Mean per run | Input tokens, all models | Main model input | Output tokens | Tool calls | Wall time | Cost |");
lines.push("|--------------|-------------------------:|-----------------:|--------------:|-----------:|----------:|-----:|");
for (const a of arms) {
  lines.push(`| ${a.arm} (${a.runs} runs) | ${fmt(a.input)} | ${fmt(a.mainInput)} | ${fmt(a.output)} | ${a.tools.toFixed(1)} | ${a.seconds.toFixed(0)}s | $${a.cost.toFixed(3)} |`);
}
lines.push(`| search / pace | ${ratio(search.input, pace.input)} | ${ratio(search.mainInput, pace.mainInput)} | ${ratio(search.output, pace.output)} | ${ratio(search.tools, pace.tools)} | ${ratio(search.seconds, pace.seconds)} | ${ratio(search.cost, pace.cost)} |`);
if (cold.runs > 0) {
  lines.push(`| search-cold / pace | ${ratio(cold.input, pace.input)} | ${ratio(cold.mainInput, pace.mainInput)} | ${ratio(cold.output, pace.output)} | ${ratio(cold.tools, pace.tools)} | ${ratio(cold.seconds, pace.seconds)} | ${ratio(cold.cost, pace.cost)} |`);
}
lines.push("");
const runDates = [...new Set(
  readdirSync(dir)
    .filter((f) => /^(search-cold|search|pace)-\d+\.jsonl$/.test(f))
    .map((f) => statSync(join(dir, f)).mtime.toISOString().slice(0, 10)),
)].sort();
lines.push(`Run date (UTC): ${runDates.join(", ")}.`);
lines.push(`Total spend: $${arms.reduce((acc, a) => acc + a.total, 0).toFixed(2)} across ${runs.length} runs. Model: ${[...new Set(runs.map((r) => r.model))].join(", ")}.`);

console.log(lines.join("\n"));
console.log("\n## Answers\n");
for (const r of runs) {
  console.log(`### ${r.arm} ${r.n}\n`);
  console.log(r.answer.trim() || "(no answer)");
  console.log("");
}
