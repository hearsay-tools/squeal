// Row 011-180: sums yield.mjs's lines for the notes. Reads only its output, no store.
// Usage: node sum.mjs <yield-*.jsonl> [workers, default 23: a tier of at most this many files starts them all at once]
import { readFileSync } from "node:fs";
const [, , file, workersArg = "23"] = process.argv;
const workers = Number(workersArg);
const runs = readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => !o.summary);
const r1 = (x) => +x.toFixed(1);
const sum = (xs, f) => r1(xs.reduce((a, x) => a + f(x), 0));
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? r1(s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const cut = (o) => o.grace + o.inFlight;
// Every file started at the tier's start: each cut file ran about the wall, so its remainder is later minus wall.
const allStarted = (o) => o.neverStarted === 0 && o.picked <= workers;
// What the yield waited for: a revision during the run (live: exact; removed: the next tier's revision is higher),
// else no revision, so a promoted file or a focused entry (C15); recreating revisions are named in `during`.
const waitedFor = (o) => (o.scope === "live" ? (o.during.length > 0 ? "revision" : "promoted") : o.next && o.next.revision > o.revision ? "revision" : "promoted");
// The 30 s overrun with no known duration (C4: a file with none counts 0): the cancel came 30 to 32 s after the start.
const atThirty = (o) => o.rule.branch !== "remainder" && o.wall >= 30 && o.wall < 32;
const branch = (o) => (atThirty(o) ? "overrun at 30 s" : o.rule.branch);
const group = (key) => {
  const m = new Map();
  for (const o of runs) { const k = key(o); m.set(k, [...(m.get(k) ?? []), o]); }
  return Object.fromEntries([...m].map(([k, xs]) => [k, { runs: xs.length, cut: sum(xs, cut), lowS: sum(xs, (o) => o.secs.low), highS: sum(xs, (o) => o.secs.high) }]));
};
// The yield's gain: how much sooner the next tier started, the cut files' remainder past the run's end (tiers whose
// files all started; the longest cut file's later duration less the wall).
const small = runs.filter(allStarted);
const left = (o) => Math.max(...o.cutFiles.map((f) => f.leftS ?? -Infinity), -Infinity);
const gains = small.filter((o) => cut(o) > 0 && o.cutFiles.every((f) => f.leftS !== null)).map((o) => ({ o, left: left(o) }));
const bucket = (x) => (x <= 0 ? "<=0" : x <= 10 ? "0-10" : x <= 30 ? "10-30" : x <= 60 ? "30-60" : ">60");
const gainBuckets = {};
for (const { o, left: l } of gains) { const b = (gainBuckets[bucket(l)] ??= { runs: 0, highS: 0, leftS: 0 }); b.runs++; b.highS = r1(b.highS + o.secs.high); b.leftS = r1(b.leftS + Math.max(0, l)); }
// A yield that threw away more than it saved: the cut files' high bound over the remainder it saved.
const lossy = gains.filter(({ o, left: l }) => o.secs.high > Math.max(0, l));
// Letting the started modules end before the cancel, up to B s: a cut file whose remainder is at most B is kept;
// the work waits the longest kept remainder, or B when a file is left to cut. Tiers whose files all started.
const keep = (B) => {
  let kept = 0, keptS = 0, keptLaterS = 0, extraS = 0, yields = 0, ended = 0;
  for (const { o } of gains) {
    const rem = o.cutFiles.map((f) => Math.max(0, f.leftS));
    const k = o.cutFiles.filter((f, i) => rem[i] <= B);
    kept += k.length; keptS += k.reduce((a, f) => a + f.highS, 0); keptLaterS += k.reduce((a, f) => a + f.laterS, 0);
    const extra = Math.min(B, Math.max(...rem)); extraS += extra; yields++;
    if (k.length === o.cutFiles.length) ended++;
  }
  return { B, yields, tiersEnded: ended, kept, keptHighS: r1(keptS), keptRerunS: r1(keptLaterS), extraWaitS: r1(extraS), extraWaitPerYieldS: r1(extraS / Math.max(1, yields)) };
};
// The same, letting end only the files whose remainder is at most B, waiting for no other (perfect estimates).
const keepShort = (B) => {
  let kept = 0, keptS = 0, extraS = 0;
  for (const { o } of gains) {
    const k = o.cutFiles.filter((f) => Math.max(0, f.leftS) <= B);
    kept += k.length; keptS += k.reduce((a, f) => a + f.highS, 0);
    extraS += k.length ? Math.max(...k.map((f) => Math.max(0, f.leftS))) : 0;
  }
  return { B, kept, keptHighS: r1(keptS), extraWaitS: r1(extraS) };
};
// The work the yield served: when it started after the run's end, and after the first revision during the run (live).
const nextGap = runs.filter((o) => o.next).map((o) => o.next.afterEndS);
const fromEvent = runs.filter((o) => o.scope === "live" && o.during.length > 0 && o.next).map((o) => r1(o.wall - o.during[0].atS + o.next.afterEndS));
// Files cut by more than one yield in the window.
const byFile = new Map();
for (const o of runs) for (const f of o.cutFiles) byFile.set(f.file, [...(byFile.get(f.file) ?? []), { run: o.run, worktree: o.worktree, revision: o.revision, highS: f.highS }]);
const repeated = [...byFile].filter(([, xs]) => xs.length > 1).map(([f, xs]) => ({ file: f, cuts: xs.length, highS: sum(xs, (x) => x.highS), runs: xs.map((x) => `${x.run}@${x.worktree}r${x.revision}`) }));
console.log(JSON.stringify({
  yields: runs.length, cut: sum(runs, cut), lowS: sum(runs, (o) => o.secs.low), highS: sum(runs, (o) => o.secs.high),
  byKind: group((o) => (o.picked > 4 ? "backlog-sized" : "edit-sized") + (o.checkpoint ? ", checkpoint" : "")),
  byWaitedFor: group(waitedFor), byBranch: group(branch), byScope: group((o) => o.scope),
  allStartedYields: small.length, gainBuckets, gainMedianS: median(gains.map((g) => g.left)),
  lossy: { runs: lossy.length, highS: sum(lossy, ({ o }) => o.secs.high), savedS: sum(lossy, ({ left: l }) => Math.max(0, l)) },
  nextTier: { afterEndMedianS: median(nextGap), over5s: nextGap.filter((x) => x > 5).length, afterEventMedianS: median(fromEvent), afterEvent: fromEvent },
  keepUpTo: [10, 30, 60].map(keep), keepShortUpTo: [10, 30].map(keepShort), repeated,
}, null, 1));
