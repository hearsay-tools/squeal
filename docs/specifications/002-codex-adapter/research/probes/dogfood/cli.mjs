// Every command the agent ran that names squeal (status, why, command -v), with
// its exit code, duration and output, from a Codex rollout. Read only.
// Usage: node cli.mjs <rollout.jsonl> [max-chars-per-output]
import { readFileSync } from "node:fs";

const [file, max = "2500"] = process.argv.slice(2);
for (const line of readFileSync(file, "utf8").trim().split("\n")) {
  const o = JSON.parse(line);
  const it = o.payload?.item;
  if (o.type !== "event_msg" || o.payload.type !== "item_completed" || it?.type !== "CommandExecution") continue;
  const cmd = it.command.at(-1);
  if (!/squeal(\.mjs)? |command -v squeal/.test(cmd)) continue;
  const secs = it.duration ? (it.duration.secs + it.duration.nanos / 1e9).toFixed(2) : "?";
  const shown = cmd.includes("<<'EOF'") ? `[heredoc writing a file] ... ${cmd.slice(cmd.lastIndexOf("EOF\n") + 4)}` : cmd;
  console.log(`== ${o.timestamp} exit=${it.exit_code} ${secs}s\n$ ${shown}`);
  const out = it.formatted_output ?? it.stdout ?? "";
  console.log(out.length > Number(max) ? `${out.slice(0, Number(max))}\n[...${out.length - Number(max)} more chars]` : out);
}
