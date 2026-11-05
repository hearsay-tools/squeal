// 011-298 probe (throwaway): seconds and files per miss cause from classify.cjs output.
// Usage: node agg.cjs out.jsonl [detail]
const fs = require("fs");
const lines = fs.readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l));
const detail = process.argv[3] === "detail";
const S = new Map(); let tot = 0, totN = 0;
const add = (c, x) => { const v = S.get(c) ?? { n: 0, sec: 0, ck: new Set() }; v.n++; v.sec += x.sec; v.ck.add(x.ck); S.set(c, v); tot += x.sec; totN++; };
const classify = (x) => {
  const p = x.prior;
  if (!x.ran) return "0 never started in the restart";
  if (p === null) return x.hasChecks ? "A no earlier run in this worktree" : "A no earlier run, no check anywhere";
  const where = p.inPrev ? "predecessor" : "older daemon";
  if (!p.completed) {
    const why = p.endedAfterT ? "still running at restart" : (p.failure ?? p.end ?? p.endState);
    return `B last own attempt stored nothing (${where}): ${detail ? why : (p.ended ? "ended, not stored" : "not ended")}`;
  }
  if (p.keys.length > 0) {
    if (x.newKeys.length === 0) return `C key unknown: restart stored nothing (${where})`;
    if (p.keys.some((k) => x.newKeys.includes(k))) return "X same key both (impossible?)";
    const sameCommit = p.commit === x.newCommit;
    const dirty = p.dirty || x.newDirty ? "dirty" : "clean";
    return `C key changed (${where}): commit ${sameCommit ? "same" : "moved"}, ${dirty}`;
  }
  if (p.after === null) return `D completed, no row, no check (${where})`;
  const ks = new Set(p.after.map((a) => a.key));
  const onlyNew = [...ks].every((k) => x.newKeys.includes(k));
  if (ks.size === 0) return `D completed, no row ever after (${where})`;
  return `D completed, row gone; later rows ${onlyNew ? "only at restart key" : "at other keys"} (${where})`;
};
for (const x of lines) add(classify(x), x);
const out = [...S].sort((a, b) => b[1].sec - a[1].sec).map(([c, v]) => `${(100 * v.sec / tot).toFixed(1).padStart(5)}%  ${Math.round(v.sec).toString().padStart(7)} s  ${String(v.n).padStart(6)} files  ${String(v.ck.size).padStart(4)} baselines  ${c}`);
console.log(`total ${Math.round(tot)} s, ${totN} files, ${new Set(lines.map((x) => x.ck)).size} baselines`); console.log(out.join("\n"));
