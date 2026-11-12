// Throwaway offline check. Opens only the saved evidence, no store or daemon.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const text = readFileSync(new URL("./evidence-2026-11-12.txt", import.meta.url), "utf8");
const entries = new Map(text.split("[issue-201] ").filter(Boolean).map((entry) => {
  const at = entry.indexOf(": ");
  return [entry.slice(0, at), JSON.parse(entry.slice(at + 2))];
}));
for (const label of ["control first", "control second", "held first", "held second (lock free)", "short first", "short second"]) {
  const value = entries.get(label);
  assert.equal(value.exit, 0);
  assert.equal(value.verdict, "pass");
}
for (const label of ["control second", "short second"]) {
  assert.deepEqual(Object.values(entries.get(label).from ?? {}), Array(5).fill("store"));
}
assert.equal(Object.keys(entries.get("held second (lock free)").from ?? {}).length, 0);
const held = entries.get("held first");
assert.match(held.stderr, /5 completed test files were not kept/);
assert(held.ms - held.reportAtMs > 29_000);
const served = entries.get("served busy");
assert.equal(served.gateWriteTransactions, 0);
assert.deepEqual(served.rowsAfterRelease, [0, 0]);
assert.match(served.notes.at(-1), /2 completed test files were not kept/);
console.log("PASS: saved evidence satisfies corrected map assertions, loss, return delay, and daemon-routing checks; no live probe rerun.");
