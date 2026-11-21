// Throwaway: rule A's funnel from population.mjs output, in the brief's order.
import { readFileSync } from "node:fs";
const { edits, timing, pairs } = JSON.parse(readFileSync(process.argv[2], "utf8"));
const ORDER = ["c1:noCompatibleRecord", "c1:noRunInWorktree", "notJudged:revisionGap", "c1:noRecordAtKey", "c1:recordNotAtOldBytes", "c2:testFileChanged", "c2:nonScriptPath", "c2:scriptNotLoaded", "c2:deleted", "c2:enteredBodyChanged", "notJudged:noOldBlob", "notJudged:noNewBlob", "notJudged:judgeError", "c2:unmappedBody", "c3:skeletonChanged", "c4:parse", "c5:childProcess", "c5:readAsData", "left"];
const table = (ps) => {
  const S = ps.reduce((a, p) => a + p.ms, 0) / 1000;
  const rows = ORDER.map((k) => { const q = ps.filter((p) => p.stage === k); const s = q.reduce((a, p) => a + p.ms, 0) / 1000; return [k, q.length, Math.round(s), +(100 * q.length / ps.length).toFixed(2), +(100 * s / S).toFixed(2)]; }).filter((r) => r[1]);
  const unknown = ps.filter((p) => !ORDER.includes(p.stage)).map((p) => p.stage);
  return { pairs: ps.length, seconds: Math.round(S), revisions: new Set(ps.map((p) => `${p.wt}:${p.rev}`)).size, rows, unknown: [...new Set(unknown)] };
};
const funnel = pairs.filter((p) => p.stage !== "x:sameAsRecord");
const relaxedView = funnel.map((p) => (p.relaxed && p.relaxed.stage !== "x:noOwnChange" ? { ...p, stage: p.relaxed.stage, verdicts: p.relaxed.verdicts, ruleB: p.relaxed.ruleB } : p));
const out = { edits, timing, sameAsRecord: pairs.length - funnel.length, all: table(funnel), span1: table(funnel.filter((p) => p.span === 1)), relaxed: table(relaxedView), relaxedOnly: table(funnel.filter((p) => p.relaxed && p.relaxed.stage !== "x:noOwnChange").map((p) => ({ ...p, stage: p.relaxed.stage }))) };
out.relaxedLeft = relaxedView.filter((p) => p.stage === "left").slice(0, 30).map((p) => [p.wt.slice(0, 8), p.rev, p.test, Math.round(p.ms)]);
// per changed loaded script path judged: what the structural comparison said
const verdicts = {};
for (const p of funnel) for (const [, v] of p.verdicts ?? []) verdicts[v] = (verdicts[v] ?? 0) + 1;
out.pathVerdicts = Object.entries(verdicts).sort((a, b) => b[1] - a[1]);
// left pairs, by test and path
out.left = funnel.filter((p) => p.stage === "left").slice(0, 40).map((p) => [p.wt.slice(0, 8), p.rev, p.test, p.changed, Math.round(p.ms)]);
// rule B: share of pairs with a record whose record entered a changed function
const judged = funnel.filter((p) => p.verdicts && p.verdicts.every(([, v]) => !/noOldBlob|noNewBlob|judgeError|unread|blobMismatch/.test(v)));
out.ruleB = { judgedPairs: judged.length, judgedSeconds: Math.round(judged.reduce((a, p) => a + p.ms, 0) / 1000), entered: judged.filter((p) => p.ruleB).length, enteredSeconds: Math.round(judged.filter((p) => p.ruleB).reduce((a, p) => a + p.ms, 0) / 1000) };
console.log(JSON.stringify(out, null, 1));
