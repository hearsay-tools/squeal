// 011-157 probe (throwaway): the main checkout's HEAD moves in the window, from its reflog (read only).
// Usage: node reflog.mjs <repo root> <copy ms> [hours=72]  -> one JSON line per move to stdout
import { readFileSync } from "node:fs";
const [, , root, copyArg, hoursArg] = process.argv;
const copyAt = Number(copyArg), since = copyAt - Number(hoursArg ?? 72) * 3600_000;
for (const l of readFileSync(root + "/.git/logs/HEAD", "utf8").trim().split("\n")) {
  const [head, msg] = l.split("\t"); const m = head.match(/^(\w+) (\w+) .*> (\d+) [+-]\d+$/);
  if (!m) continue; const at = Number(m[3]) * 1000;
  if (at < since || at > copyAt) continue;
  console.log(JSON.stringify({ at, iso: new Date(at).toISOString(), from: m[1], to: m[2], msg }));
}
