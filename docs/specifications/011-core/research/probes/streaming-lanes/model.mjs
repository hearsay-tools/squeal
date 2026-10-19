// THROWAWAY probe (011-core/research/streaming-lanes.md). Replays a lane's backlog offline on
// fixed durations, no runner: every file takes exactly its last-known time, files in C4 order
// (shortest last-known first), W workers. Rules:
//   today:  tiers while the serial sum <= 300 s (first file always), tiers run one after another.
//   w1:     tiers of one round (W files), then while sum/W + (1 - 1/W) * longest <= 120 s.
//   stream: no tiers; each of W slots starts the next queued file when it frees.
// The edit's wait is from the edit to the moment its file can start: the end of the tier in
// flight (today, w1: node:test and pytest run a tier to the end), the first slot to free
// (stream), or 0 (stream-over: an edit's file starts beside the W slots).
// Exported for sweep.mjs and cezar.mjs; run alone it prints the heavy fixture's numbers.
export const sum = (ds) => ds.reduce((a, b) => a + b, 0);
export function greedy(ds, w) {
  // Start times and ends of files placed in order on the earliest free of w workers.
  const free = Array(Math.max(1, w)).fill(0);
  const ends = [];
  for (const d of ds) {
    const i = free.indexOf(Math.min(...free));
    free[i] += d;
    ends.push(free[i]);
  }
  return { makespan: Math.max(0, ...free), free };
}
const graham = (ds, w) => sum(ds) / w + (1 - 1 / w) * Math.max(...ds);
const fits = {
  today: (ds) => sum(ds) <= 300,
  w1: (ds, w) => ds.length <= w || graham(ds, w) <= 120,
};
/** Tiers as [start, end] for a tiered rule; tiers start when the previous ends. */
export function tiers(durations, rule, w, cap = 200) {
  const q = [...durations].sort((a, b) => a - b);
  const out = [];
  let t = 0;
  while (q.length) {
    const tier = [q.shift()];
    while (q.length && tier.length < cap && fits[rule]([...tier, q[0]], w)) tier.push(q.shift());
    const wall = greedy(tier, Math.min(w, tier.length)).makespan;
    out.push({ files: tier.length, start: t, end: t + wall });
    t += wall;
  }
  return out;
}
/** Slot frees (file ends) of the streaming lane, sorted, and its makespan. */
export function stream(durations, w) {
  const q = [...durations].sort((a, b) => a - b);
  const free = Array(w).fill(0);
  const ends = [];
  for (const d of q) {
    const i = free.indexOf(Math.min(...free));
    free[i] += d;
    ends.push(free[i]);
  }
  return { makespan: Math.max(...free), ends: ends.sort((a, b) => a - b) };
}
/** The wait of an edit landing at `at` until its file starts. */
export function waitAt(rule, durations, w, at) {
  if (rule === "stream-over") return 0;
  if (rule === "stream") {
    const { ends } = stream(durations, w);
    const next = ends.find((e) => e > at);
    return next === undefined ? 0 : next - at;
  }
  const ts = tiers(durations, rule, w);
  const t = ts.find((x) => x.start <= at && at < x.end);
  return t === undefined ? 0 : t.end - at;
}
/** Backlog time, the longest and mean wait of an edit at a uniformly random moment of it. */
export function summary(rule, durations, w, steps = 2000) {
  const total =
    rule.startsWith("stream") ? stream(durations, w).makespan : tiers(durations, rule, w).at(-1).end;
  let mean = 0;
  let max = 0;
  for (let i = 0; i < steps; i++) {
    const x = waitAt(rule, durations, w, ((i + 0.5) * total) / steps);
    mean += x / steps;
    max = Math.max(max, x);
  }
  return { totalS: Math.round(total), meanWaitS: Math.round(mean), maxWaitS: Math.round(max) };
}
export const spread = (n, lo, hi) => Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
if (import.meta.url === `file://${process.argv[1]}`) {
  const fixture = spread(16, 20, 90).map(Math.round);
  console.log("fixture node:test, 16 files 20-90 s, W=4:", fixture.join(","));
  for (const rule of ["today", "w1", "stream", "stream-over"]) {
    const s = summary(rule, fixture, 4);
    const at100 = waitAt(rule, fixture, 4, 100);
    const shape = rule.startsWith("stream") ? "" : tiers(fixture, rule, 4).map((t) => `${t.files}f ${t.start.toFixed(0)}-${t.end.toFixed(0)}`).join(" | ");
    console.log(`  ${rule}: ${JSON.stringify(s)}, edit at 100 s waits ${at100.toFixed(1)} s ${shape}`);
  }
}
/**
 * Vitest's cancel (C4 step 5): an edit at `at` cancels the backlog tier in flight, and the files
 * that started and had not ended lose what they ran. The mean of that loss over a uniformly
 * random moment of the backlog, in seconds of worker time; streaming with an edit's slot beside
 * the others cancels nothing.
 */
export function meanCancelLoss(rule, durations, w, steps = 2000) {
  if (rule.startsWith("stream")) return 0;
  const ts = tiers(durations, rule, w);
  const q = [...durations].sort((a, b) => a - b);
  const spans = [];
  for (const t of ts) {
    const files = q.splice(0, t.files);
    const free = Array(Math.min(w, files.length)).fill(t.start);
    for (const d of files) {
      const i = free.indexOf(Math.min(...free));
      spans.push([free[i], free[i] + d]);
      free[i] += d;
    }
  }
  const total = ts.at(-1).end;
  let mean = 0;
  for (let i = 0; i < steps; i++) {
    const at = ((i + 0.5) * total) / steps;
    const tier = ts.find((x) => x.start <= at && at < x.end);
    mean += spans.filter(([s, e]) => s >= tier.start && s <= at && e > at).reduce((a, [s]) => a + (at - s), 0) / steps;
  }
  return Math.round(mean);
}
/** Each file's [start, end] under a tiered rule, tiers one after another. */
export function spans(durations, rule, w) {
  const ts = tiers(durations, rule, w);
  const q = [...durations].sort((a, b) => a - b);
  const out = [];
  for (const t of ts) {
    const files = q.splice(0, t.files);
    const free = Array(Math.min(w, files.length)).fill(t.start);
    for (const d of files) {
      const i = free.indexOf(Math.min(...free));
      out.push({ start: free[i], end: free[i] + d, tier: t });
      free[i] += d;
    }
  }
  return { ts, out };
}
/**
 * The edit's options of the human's question 4 on a tiered rule (node:test, pytest), an edit at
 * a uniformly random moment: `after` waits for the tier's end (today); `drain` starts no further
 * file and waits for the running ones; `kill` stops them (wait 0, plus a SIGKILL grace of at most
 * 2 s; their run so far is lost); `beside` starts the edit's tier at once. Mean and longest wait,
 * and the mean worker-seconds lost per edit.
 */
export function editOptions(durations, rule, w, steps = 2000) {
  const { ts, out } = spans(durations, rule, w);
  const total = ts.at(-1).end;
  const acc = { after: [0, 0], drain: [0, 0], kill: [0, 0], beside: [0, 0] };
  let killLoss = 0;
  for (let i = 0; i < steps; i++) {
    const at = ((i + 0.5) * total) / steps;
    const tier = ts.find((x) => x.start <= at && at < x.end);
    const running = out.filter((f) => f.tier === tier && f.start <= at && f.end > at);
    const waits = {
      after: tier.end - at,
      drain: Math.max(0, ...running.map((f) => f.end - at)),
      kill: 0,
      beside: 0,
    };
    for (const k of Object.keys(acc)) {
      acc[k][0] += waits[k] / steps;
      acc[k][1] = Math.max(acc[k][1], waits[k]);
    }
    killLoss += running.reduce((a, f) => a + (at - f.start), 0) / steps;
  }
  const r = (x) => Math.round(x);
  return {
    after: `${r(acc.after[0])} / ${r(acc.after[1])}`,
    drain: `${r(acc.drain[0])} / ${r(acc.drain[1])}`,
    kill: `0 / 0, loses ${r(killLoss)}`,
    beside: "0 / 0",
  };
}
