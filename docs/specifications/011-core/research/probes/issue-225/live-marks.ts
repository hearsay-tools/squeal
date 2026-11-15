// Throwaway, read-only: lists the live per-user pool marks on this host. Writes nothing.
import { readMarks } from "../../../../../../src/core/capacity/marks.js";
import { slowSlotDir } from "../../../../../../src/core/slow/slot.js";
const dir = slowSlotDir();
const now = Date.now();
const marks = readMarks(dir, "issue-225-reader", now);
console.log(JSON.stringify({ dir, at: new Date(now).toISOString(), marks: marks.length }));
for (const m of marks)
  console.log(JSON.stringify({ ...m, id: m.id.slice(0, 8), waitingS: m.since === null ? null : Math.round((now - m.since) / 1000) }));
