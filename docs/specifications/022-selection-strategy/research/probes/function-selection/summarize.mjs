// Throwaway: prints rule A's funnel from replay.mjs output, for several subsets.
import { readFileSync } from "node:fs";
const { counts, pairs } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ORDER = ["c1:noRecord", "c1:recordNotAtOldBytes", "c2:keyMovedOutsideKnownClosure", "c2:testFileChanged", "c2:nonScriptPath", "c2:scriptNotLoaded", "c2:deleted", "c2:enteredBodyChanged", "notJudged:noOldBlob", "notJudged:noNewBlob", "notJudged:judgeError", "c2:unmappedBody", "c3:skeletonChanged", "c4:parse", "c5:childProcess", "c5:readAsData", "left"];
const subsets = {
  all: () => true,
  single: (p) => p.single,
  singleNoHead: (p) => p.single && !p.headMoved && p.watchOnly,
  small: (p) => !p.headMoved && p.watchOnly && p.nChanged <= 3,
  headMoved: (p) => p.headMoved,
};
const result = { counts, subsets: {} };
for (const [name, f] of Object.entries(subsets)) {
  const ps = pairs.filter(f);
  const total = { n: ps.length, s: ps.reduce((a, p) => a + p.ms, 0) / 1000 };
  const rows = {};
  for (const k of ORDER) {
    const q = ps.filter((p) => p.stage === k);
    rows[k] = { n: q.length, s: Math.round(q.reduce((a, p) => a + p.ms, 0) / 1000), pctN: +(100 * q.length / total.n).toFixed(2), pctS: +(100 * q.reduce((a, p) => a + p.ms, 0) / 1000 / total.s).toFixed(2) };
  }
  const revisions = new Set(ps.map((p) => `${p.wt}:${p.rev}`)).size;
  result.subsets[name] = { pairs: total.n, seconds: Math.round(total.s), revisions, funnel: rows };
}
console.log(JSON.stringify(result, null, 1));
