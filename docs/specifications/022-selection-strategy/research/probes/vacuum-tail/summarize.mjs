#!/usr/bin/env node
// Summarizes one probe run directory (prune.jsonl, writer.jsonl) as Markdown
// tables: per phase and kind of slice, the lock hold, its work and its
// COMMIT, split by whether SQLite checkpointed inside the commit; and the
// other writer's wait for the lock.
//
// Usage: node summarize.mjs <run dir>...
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file) =>
  existsSync(file)
    ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const q = (xs, p) => {
  if (xs.length === 0) return "";
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
};
const max = (xs) => (xs.length === 0 ? "" : Math.round(Math.max(...xs)));
const over = (xs, ms) => xs.filter((x) => x > ms).length;

for (const dir of process.argv.slice(2)) {
  const prune = read(join(dir, "prune.jsonl"));
  const writer = read(join(dir, "writer.jsonl"));
  console.log(`\n### ${dir}\n`);
  console.log(
    "| phase | kind | in commit checkpoint | n | hold p50 | p95 | max | >100 | >150 | >250 | work max | commit p50 | commit max | longest step | frames p50 | frames max |",
  );
  console.log("|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
  const groups = new Map();
  for (const r of prune) {
    const k = `${r.phase}|${r.kind}|${r.kind === "checkpoint" ? "-" : r.checkpointed ? "yes" : "no"}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  for (const [k, rs] of [...groups].sort()) {
    const [phase, kind, ck] = k.split("|");
    if (kind === "checkpoint") {
      const ms = rs.map((r) => r.ms);
      console.log(
        `| ${phase} | checkpoint slice (no write lock) | - | ${rs.length} | ${q(ms, 0.5)} | ${q(ms, 0.95)} | ${max(ms)} | ${over(ms, 100)} | ${over(ms, 150)} | ${over(ms, 250)} | | | | | ${q(rs.map((r) => r.walBefore), 0.5)} | ${max(rs.map((r) => r.walBefore))} |`,
      );
      continue;
    }
    const hold = rs.map((r) => r.hold);
    const frames = rs.map((r) => r.frames).filter((f) => f !== null);
    console.log(
      `| ${phase} | ${kind} | ${ck} | ${rs.length} | ${q(hold, 0.5)} | ${q(hold, 0.95)} | ${max(hold)} | ${over(hold, 100)} | ${over(hold, 150)} | ${over(hold, 250)} | ${max(rs.map((r) => r.work))} | ${q(rs.map((r) => r.commit), 0.5)} | ${max(rs.map((r) => r.commit))} | ${max(rs.flatMap((r) => r.ops))} | ${q(frames, 0.5)} | ${max(frames)} |`,
    );
  }
  if (writer.length > 0) {
    const wait = writer.map((w) => w.wait);
    const commit = writer.map((w) => w.commit);
    const total = writer.map((w) => w.wait + w.commit);
    console.log("\nOther writer (one small transaction every 20 ms):\n");
    console.log("| n | wait p50 | p95 | p99 | max | >100 | >250 | commit p99 | commit max | wait+commit max |");
    console.log("|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|");
    console.log(
      `| ${writer.length} | ${q(wait, 0.5)} | ${q(wait, 0.95)} | ${q(wait, 0.99)} | ${max(wait)} | ${over(wait, 100)} | ${over(wait, 250)} | ${q(commit, 0.99)} | ${max(commit)} | ${max(total)} |`,
    );
  }
}
