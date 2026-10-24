// Throwaway probe for 015-26. Not product code.
//   tsx replay-edits.mts <session dir> <base root> <relative path> <qualified name>
// Replays the session's Edit tool calls on <relative path>, in order, on the base copy under
// <base root>, and prints the function's CC and body hash change after each.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countFile } from "../../../../../../src/core/code/count/index.ts";

const [dir, baseRoot, path, name] = process.argv.slice(2);
let text = readFileSync(join(baseRoot, path), "utf8");
const t0Line = readFileSync(join(dir, "stream.jsonl"), "utf8").split("\n").filter(Boolean);
const t0 = Number(t0Line[0].split(" ")[0]);

async function at(label: string, prevHash: string | null) {
  const count = await countFile(text, "typescript");
  const fn = count.functions.find((f) => f.qualifiedName === name && f.occurrence === 0);
  const over = count.functions.filter((f) => f.complexity > 20).length;
  const hash = fn?.bodyHash ?? null;
  const moved = prevHash === null ? "" : hash === prevHash ? "body same" : "body moved";
  console.log(`${label.padEnd(10)} ${name} CC ${fn?.complexity ?? "gone"}  ${moved}  (${over} over 20 in file)`);
  return hash;
}

let hash = await at("base", null);
for (const raw of t0Line) {
  const [ts, ...rest] = raw.split(" ");
  let ev: any;
  try {
    ev = JSON.parse(rest.join(" "));
  } catch {
    continue;
  }
  if (ev.type !== "assistant") continue;
  for (const c of ev.message?.content ?? []) {
    if (c.type !== "tool_use" || c.name !== "Edit" || !String(c.input.file_path).endsWith(path)) continue;
    const { old_string: a, new_string: b, replace_all: all } = c.input;
    if (!text.includes(a)) {
      console.log(`edit at ${((Number(ts) - t0) / 1000).toFixed(1)} s does not apply`);
      continue;
    }
    text = all ? text.split(a).join(b) : text.replace(a, () => b);
    hash = await at(`${((Number(ts) - t0) / 1000).toFixed(1)} s`, hash);
  }
}
