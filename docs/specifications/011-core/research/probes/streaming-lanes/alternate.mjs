// THROWAWAY probe (011-core/research/streaming-lanes.md). Vitest with two instances alternating,
// replayed offline: a tier (W1's rule at the width it starts with) runs on one instance at a fixed
// width; once one of its workers idles and the other instance is free, the next tier starts there
// at the idle workers' count, or once a share of W idles. At most two tiers overlap, one per instance. Against W1 on one
// instance and against streaming slots. Same assumptions as model.mjs; cezar's data as cezar.mjs.
import { readFileSync } from "node:fs";
import { sum, stream, tiers } from "./model.mjs";

const graham = (ds, w) => sum(ds) / w + (1 - 1 / w) * Math.max(...ds);
function pick(q, w) {
  const tier = [q.shift()];
  while (q.length && tier.length < 200 && (tier.length < w || graham([...tier, q[0]], w) <= 120)) tier.push(q.shift());
  return tier;
}
export function alternate(durations, W, share = 0) {
  // The next tier starts once at least `share` of W workers idle (0: the first idle worker).
  const enough = Math.max(1, Math.ceil(W * share));
  const q = [...durations].sort((a, b) => a - b);
  let t = 0;
  let free = W; // idle workers
  const running = []; // { workers: number[] (end times), pending: number[] }
  const events = []; // worker frees: { at, tier }
  let instancesBusy = 0;
  let end = 0;
  const start = (width) => {
    const files = pick(q, width);
    const ends = Array(Math.min(width, files.length)).fill(t);
    const tier = { left: files.length, ends };
    for (const d of files) {
      const i = ends.indexOf(Math.min(...ends));
      ends[i] += d;
    }
    // Each worker frees when its last file ends; the run ends when all do.
    for (const e of ends) events.push({ at: e, tier });
    free -= ends.length;
    free += 0;
    tier.workers = ends.length;
    tier.done = Math.max(...ends);
    instancesBusy += 1;
    running.push(tier);
  };
  start(W);
  while (events.length) {
    events.sort((a, b) => a.at - b.at);
    const ev = events.shift();
    t = ev.at;
    free += 1;
    ev.tier.workers -= 1;
    if (ev.tier.workers === 0) {
      instancesBusy -= 1;
      end = Math.max(end, t);
    }
    if (q.length && instancesBusy < 2 && (free >= enough || instancesBusy === 0)) start(free);
  }
  return Math.round(end);
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const { tiers: rec } = JSON.parse(readFileSync(new URL("../backlog-wall-budget/results/cezar-701f50.json", import.meta.url)));
  const done = rec.filter((x) => x.wallS !== null);
  const tail = done.filter((x) => x.startedAt >= "2026-10-19T13:06:12").flatMap((x) => x.fileS);
  const vitest = done.filter((x) => x.files !== 54).flatMap((x) => x.fileS);
  for (const [name, ds] of [["Vitest tail, 47 files", tail], [`Vitest whole backlog, ${vitest.length} files`, vitest]]) {
    for (const W of [23, 6]) {
      console.log(`${name}, W=${W}: w1 one instance ${Math.round(tiers(ds, "w1", W).at(-1).end)} s; two alternating ${[0, 0.25, 0.5].map((f) => `${alternate(ds, W, f)} s at ${f * 100} % idle`).join(", ")}; streaming ${Math.round(stream(ds, W).makespan)} s`);
    }
  }
}
