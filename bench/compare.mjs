// The scorecard's comparison of paired or repeated runs (README.md, "Scorecard").
// Per cell and version: the mean score with its range, and the mean of each raw
// number with its spread across runs (min to max). Row 025-27: a change whose
// ranges overlap the first version's is marked "noise", since the runs of one
// version already differ that much from each other.

export const AREAS = ["Hooks", "Commands", "Verdicts", "Resources", "Store"];

export const fmt = (m, x) => {
  if (x === null || x === undefined || Number.isNaN(x)) return "n/a";
  if (x === Number.POSITIVE_INFINITY) return "late";
  const d = m.unit === "x" ? 2 : Math.abs(x) < 10 && !Number.isInteger(x) ? 1 : 0;
  return `${x.toFixed(d)}${m.unit && m.unit !== "rows" ? ` ${m.unit}` : ""}`;
};

/** Raw numbers the comparison shows for each cell: the ones a change to the store or the hooks moves. */
const RAW = [
  "hook.preToolUse.p50",
  "hook.preToolUse.p95",
  "hook.postToolBatch.p50",
  "hook.postToolBatch.p95",
  "hook.preToolUse.p99",
  "hook.postToolBatch.p99",
  "hook.writeWait.max",
  "hook.longWriteWaits",
  "hook.sessionStart.max",
  "cmd.status.p95",
  "ff.queued",
  "ff.drainS",
  "ff.lateNotices",
  "ff.editVerdict.p50",
  "session.pushFail.p50",
  "session.verdict.within60s",
  "res.idleCpu.maxPct",
  "res.cpuPerEdit",
  "res.daemonRss.max",
  "res.treeRss.max",
  "res.storeProcess.rss",
  "store.longWrites",
  "store.longWrite.maxMs",
  "store.longWrite.totalS",
  "cmd.impact.s",
  "res.impact.rss",
];

const finite = (xs) => xs.filter((x) => typeof x === "number" && Number.isFinite(x));

/** Mean, min and max of the finite numbers, or null when there are none. */
export function spread(xs) {
  const v = finite(xs);
  if (v.length === 0) return null;
  return {
    n: v.length,
    mean: v.reduce((a, b) => a + b, 0) / v.length,
    min: Math.min(...v),
    max: Math.max(...v),
  };
}

/**
 * A change is noise when both versions ran at least twice and their ranges
 * overlap. This is an agreed, conservative rule (row 025-27), not a test of
 * statistical significance.
 */
export function isNoise(a, b) {
  if (!a || !b || a.n < 2 || b.n < 2) return false;
  return Math.max(a.min, b.min) <= Math.min(a.max, b.max);
}

const NOISE = " noise";

/**
 * Paired or repeated runs: per cell and version, the mean score (with its
 * range when repeated), the change of the mean against the first version, and
 * the mean and spread of the raw numbers in `RAW`, so a change too small to
 * move a score band still shows, and a change inside the spread says so.
 */
export function comparison(run, metrics) {
  const { meta, pluginOrder } = run;
  const labels = pluginOrder.length ? pluginOrder : [undefined];
  const bases = [...new Set(meta.cells.map((c) => c.base ?? c.name))];
  const title =
    labels.length > 1
      ? `${labels[0]} compared with ${labels.slice(1).join(", ")} (same machine, cells alternated)`
      : "Repeats";
  const out = ["", `## ${title}`, ""];
  out.push(
    `| Cell | Version | Runs | Correct | Score (range) | Δ | ${AREAS.map((a) => `${a} Δ`).join(" | ")} |`,
  );
  out.push(`|---|---|---:|---|---:|---:|${AREAS.map(() => "---:").join("|")}|`);
  const later = labels.slice(1);
  const deltaHeads = later.map((l) => (later.length === 1 ? "Δ%" : `Δ% ${l}`));
  const raw = [
    "",
    "Raw numbers, mean per cell and version with the range across runs (min–max) when repeated. Δ% is against the first version; **noise** marks a change whose range overlaps the first version's.",
    "",
  ];
  raw.push(
    `| Cell | Metric | ${[...labels.map((l) => l ?? "value"), ...deltaHeads].join(" | ")} |`,
  );
  raw.push(`|---|---|${[...labels, ...later].map(() => "---:").join("|")}|`);
  for (const base of bases) {
    if (runsOf(run, base, labels[0]).length === 0) continue;
    for (const label of labels) {
      const row = scoreRow(run, base, label, labels[0]);
      if (row) out.push(row);
    }
    raw.push(...rawRows(run, base, labels, metrics));
  }
  return [...out, ...raw];
}

function runsOf({ meta, results }, base, label) {
  return meta.cells
    .filter((c) => (c.base ?? c.name) === base && c.plugin === label && results[c.name])
    .map((c) => c.name);
}

function signed(d) {
  return `${d >= 0 ? "+" : ""}${d.toFixed(0)}`;
}

function scoreRow(run, base, label, first) {
  const { scores, areaScores, gateFails } = run;
  const ns = runsOf(run, base, label);
  if (ns.length === 0) return null;
  const firstRuns = runsOf(run, base, first);
  const s = spread(ns.map((n) => scores[n]));
  const f = spread(firstRuns.map((n) => scores[n]));
  const range = s && s.n > 1 ? ` (${s.min.toFixed(0)}–${s.max.toFixed(0)})` : "";
  const isFirst = label === first;
  const d = isFirst || !s || !f ? "" : `${signed(s.mean - f.mean)}${isNoise(f, s) ? NOISE : ""}`;
  const areas = AREAS.map((a) => {
    const x = spread(ns.map((n) => areaScores[n][a]));
    const y = spread(firstRuns.map((n) => areaScores[n][a]));
    return isFirst || !x || !y ? "" : signed(100 * (x.mean - y.mean));
  });
  const correct = ns.every((n) => gateFails[n].length === 0) ? "✅" : "❌";
  return `| ${base} | ${label ?? ""} | ${ns.length} | ${correct} | ${s?.mean.toFixed(0) ?? "n/a"}${range} | ${d} | ${areas.join(" | ")} |`;
}

/** `135 ms (116–157)` for repeated runs, `135 ms` for one. */
function valueText(m, s) {
  if (!s) return "n/a";
  const [lo, hi] = [fmt(m, s.min).split(" ")[0], fmt(m, s.max).split(" ")[0]];
  const range = s.n > 1 && lo !== hi ? ` (${lo}–${hi})` : "";
  return `${fmt(m, s.mean)}${range}`;
}

function rawRows(run, base, labels, metrics) {
  const rows = [];
  for (const id of RAW) {
    const m = metrics.find((x) => x.id === id);
    const vals = labels.map((l) => spread(runsOf(run, base, l).map((n) => run.results[n].v[id])));
    if (vals.every((x) => x === null)) continue;
    const deltas = vals.slice(1).map((v) => {
      const f = vals[0];
      if (!f?.mean || !v) return "";
      return `${signed((100 * (v.mean - f.mean)) / f.mean)}%${isNoise(f, v) ? NOISE : ""}`;
    });
    rows.push(
      `| ${base} | ${m.what} | ${[...vals.map((s) => valueText(m, s)), ...deltas].join(" | ")} |`,
    );
  }
  return rows;
}
