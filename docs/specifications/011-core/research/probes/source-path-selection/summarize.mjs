// Throwaway: one `squeal status --json <paths>` payload on stdin -> one line.
import { readFileSync } from "node:fs";
const j = JSON.parse(readFileSync(0, "utf8"));
const s = j.selection;
const files = (s.testFiles ?? []).map((f) => f.path);
const states = {};
for (const f of s.testFiles ?? []) states[f.state] = (states[f.state] ?? 0) + 1;
const start = files.filter((f) => /^test\/daemon\/start-[a-z]+\.test\.ts$/.test(f)).map((f) => f.replace(/^test\/daemon\//, ""));
const per = (s.paths ?? []).map((p) => `${p.path.split("/").pop()}=${p.selects}`).join(" ");
console.log(`${new Date().toISOString()} rev=${j.revision?.number ?? j.revision} union=${files.length} ${per} states=${JSON.stringify(states)} start-*=[${start.join(",")}]`);
