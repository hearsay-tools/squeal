// 011-82 probe: 716a6766's 23 checkpoint batches against its revisions.
// Usage: node burst.mjs results/716a6766.txt
// For each 200-file batch: seconds since the last revision at its start,
// seconds to the next revision, its wall and what it stored; and which a
// quiet period of Q s after a cancelled batch would have held back.
import { readFileSync } from "node:fs";

const lines = readFileSync(process.argv[2], "utf8").split("\n");
const t = (hms) => {
  const [h, m, s] = hms.split(":").map(Number);
  return h * 3600 + m * 60 + s;
};
const revs = lines.filter((l) => l.startsWith("rev ")).map((l) => {
  const [, n, at, , , , , ...paths] = l.split(" ");
  return { n: Number(n), at: t(at), paths };
});
const runs = lines.filter((l) => l.startsWith("run ")).map((l) => {
  const m = l.match(/rev=(\d+) (\S+) files=(\d+) (\d+)s .* keys=(\d+)/);
  return { rev: Number(m[1]), at: t(m[2]), files: Number(m[3]), wall: Number(m[4]), keys: Number(m[5]) };
});
const batches = runs.filter((r) => r.files === 200);
let previousCancelled = false;
const rows = batches.map((b) => {
  const last = revs.filter((r) => r.at <= b.at).at(-1);
  const next = revs.find((r) => r.at > b.at);
  const before = last === undefined ? null : b.at - last.at;
  const after = next === undefined ? null : next.at - b.at;
  const cancelled = next !== undefined && next.at <= b.at + b.wall;
  const row = { at: b.at, rev: b.rev, wall: b.wall, keys: b.keys, before, after, cancelled, afterCancel: previousCancelled };
  previousCancelled = cancelled;
  return row;
});
const hms = (s) => new Date(s * 1000).toISOString().slice(11, 19);
for (const r of rows)
  console.log(`${hms(r.at)} rev ${r.rev} wall ${r.wall}s stored ${r.keys} before ${r.before}s after ${r.after ?? "-"}s ${r.cancelled ? "cancelled" : "ended"}${r.afterCancel ? " (after a cancel)" : ""}`);
for (const q of [10, 20, 30]) {
  const held = rows.filter((r) => r.afterCancel && r.before !== null && r.before < q);
  console.log(`Q ${q} s after a cancel: holds ${held.length} of ${rows.length} batches, ${held.length * 200} picks, ${held.reduce((a, r) => a + r.wall, 0)} s of batch time, ${held.reduce((a, r) => a + r.keys, 0)} stored files deferred`);
}
