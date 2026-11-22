// Makes the counting copy of the bundle: logs the start's walk split to /tmp/sq-walks.jsonl. Not used for timings.
import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2];
let s = readFileSync(f, "utf8");
const a = `    const isProven = file.key !== null && list2 !== void 0 && !unresolved(file.ref, list2) && walkedAt(file.ref, file.key);`;
const a2 = `    const why = file.key === null ? "noKey" : list2 === void 0 ? "noList" : unresolved(file.ref, list2) ? "absentPath" : !walkedAt(file.ref, file.key) ? "noWalkAtKey" : "proven";
    globalThis.__sqWhy ??= {}; globalThis.__sqWhy[why] = (globalThis.__sqWhy[why] ?? 0) + 1;
    const isProven = why === "proven";`;
const b = `  if (proven2.length > 0) {\n    storeClosures(`;
const b2 = `  try { process.getBuiltinModule("node:fs").appendFileSync("/tmp/sq-walks.jsonl", JSON.stringify({ t: Date.now(), pid: process.pid, root: context.root, step: "recheck", misses: misses.length, proven: proven2.length, walked: unproven2.length, why: globalThis.__sqWhy }) + "\\n"); globalThis.__sqWhy = {}; } catch {}
  if (proven2.length > 0) {\n    storeClosures(`;
const c = `  await resolveClosures(context, unresolved, failures, bound);`;
const c2 = `  try { process.getBuiltinModule("node:fs").appendFileSync("/tmp/sq-walks.jsonl", JSON.stringify({ t: Date.now(), pid: process.pid, root: context.root, step: "unresolved", walked: unresolved.length }) + "\\n"); } catch {}
  await resolveClosures(context, unresolved, failures, bound);`;
for (const [x, y] of [[a, a2], [b, b2], [c, c2]]) {
  const n = s.split(x).length - 1;
  if (n !== 1) throw new Error("match count " + n + " for " + x.slice(0, 60));
  s = s.replace(x, y);
}
writeFileSync(f, s);
console.log("instrumented", f);
