// Throwaway: the tool calls, hook texts and final message of one session's events, one per line.
import { readFileSync } from "node:fs";
const ev = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cut = (s, n = 300) => String(s).replace(/\n/g, "⏎").slice(0, n);
for (const e of ev) {
  if (e.type === "system" && e.subtype === "init") console.log(`${e.t}\tinit\t${e.claude_code_version} ${e.model} plugins=${e.plugins.map((p) => p.name).join(",")}`);
  if (e.type === "system" && e.subtype === "hook_response" && e.output) console.log(`${e.t}\thook\t${e.hook_name}\t${cut(e.output, 400)}`);
  if (e.type === "assistant") for (const c of e.message.content) if (c.type === "tool_use") console.log(`${e.t}\ttool\t${c.name}\t${cut(JSON.stringify(c.input))}`);
  if (e.type === "result") console.log(`${e.t}\tresult\tcost=${e.total_cost_usd} turns=${e.num_turns}\t${cut(e.result, 4000)}`);
  const i = e.item;
  if (i && e.type === "item.completed") {
    if (i.type === "command_execution") console.log(`${e.t}\tshell\texit=${i.exit_code}\t${cut(i.command)}`);
    else if (i.type === "agent_message") console.log(`${e.t}\tmessage\t${cut(i.text, 4000)}`);
    else console.log(`${e.t}\t${i.type}\t${cut(JSON.stringify(i), 200)}`);
  }
  if (e.type === "turn.completed") console.log(`${e.t}\tusage\t${JSON.stringify(e.usage)}`);
}
