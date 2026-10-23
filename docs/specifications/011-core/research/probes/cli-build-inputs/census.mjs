// Throwaway probe for 011-127: groups builders.jsonl by test file, with the entry each call built.
import { readFileSync } from "node:fs";

const [log, json] = process.argv.slice(2);
const root = "/tmp/r127/repo/";
const rows = readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const durations = new Map();
if (json) {
  for (const f of JSON.parse(readFileSync(json, "utf8")).testResults ?? []) {
    durations.set(f.name.replace(root, ""), ((f.endTime ?? 0) - (f.startTime ?? 0)) / 1000);
  }
}
const byTest = new Map();
for (const r of rows) {
  const test = (r.test ?? "(no test)").replace(root, "");
  let entry;
  if (r.kind === "tsc") {
    const p = r.detail[r.detail.indexOf("-p") + 1] ?? r.detail.join(" ");
    entry = `tsc -p ${p.replace(root, "")}`;
  } else {
    const d = r.detail ? JSON.parse(r.detail) : {};
    const eps = Array.isArray(d.entryPoints) ? d.entryPoints : Object.values(d.entryPoints ?? {});
    const names = eps.map((e) => (typeof e === "string" ? e : e.in)).map((e) => String(e).replace(root, "").replace(/^\/tmp\/[^ ]*?\/(src|test)\//, "<tmp>/$1/"));
    entry = `${r.kind} ${d.stdin ? "stdin " : ""}${names.slice(0, 3).join(",")}${names.length > 3 ? ` +${names.length - 3}` : ""}`;
  }
  const t = byTest.get(test) ?? new Map();
  t.set(entry, (t.get(entry) ?? 0) + 1);
  byTest.set(test, t);
}
const dirs = new Map();
for (const [test, entries] of [...byTest].sort()) {
  const dir = test.split("/").slice(0, test.startsWith("test/keys/validity") ? 3 : 2).join("/");
  dirs.set(dir, (dirs.get(dir) ?? 0) + 1);
  const d = durations.get(test);
  console.log(`${test}${d === undefined ? "" : `  (${d.toFixed(1)} s)`}`);
  for (const [e, n] of entries) console.log(`    ${n}x ${e}`);
}
console.log("\nby directory:", Object.fromEntries([...dirs].sort()));
console.log("files:", byTest.size);
