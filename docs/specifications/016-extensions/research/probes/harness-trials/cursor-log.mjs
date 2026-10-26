// Throwaway probe (016-35). Prints one line per hook call of the Cursor
// sessions in ~/ht035/logs, for cursor-sessions.txt:
//   <name>.hooks.jsonl  (cursor-hook.mjs): time, source, event, tool, input, loop_count, answer, exit
//   <name>.squeal.jsonl (cursor-squeal.mjs): time, event, tool, input, bundle exit, answer to Cursor
// Neither log holds user_email; Squeal's text is cut to its first 260 chars.
import { existsSync, readFileSync } from "node:fs";

const logs = `${process.env.HOME}/ht035/logs`;
const lines = (path) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cut = (v, n) => (v === undefined || v === null ? "" : JSON.stringify(v).slice(0, n));
for (const name of process.argv.slice(2)) {
  console.log(`== ${name}`);
  if (existsSync(`${logs}/${name}.hooks.jsonl`)) {
    for (const l of lines(`${logs}/${name}.hooks.jsonl`)) {
      console.log(l.at.slice(11, 19), l.src, l.event, l.tool ?? "", cut(l.tool_input, 70), l.loop_count ?? "", l.status ?? "", "answer", cut(l.answered, 120), "exit", l.exit);
    }
    const first = lines(`${logs}/${name}.hooks.jsonl`)[0];
    console.log("ancestry of the first call:", first.ancestry.slice(0, 3).map((a) => a.replace(/^\d+:/, "")).join(" <- "));
    console.log("payload keys of the first call:", first.keys.join(","));
  }
  if (existsSync(`${logs}/${name}.squeal.jsonl`)) {
    for (const l of lines(`${logs}/${name}.squeal.jsonl`)) {
      console.log(l.at.slice(11, 19), l.cursorEvent, l.loop_count ?? "", l.input.tool_name ?? "", cut(l.input.tool_input, 60), "exit", l.exit, "answer", cut(l.out, 260));
    }
  }
}
