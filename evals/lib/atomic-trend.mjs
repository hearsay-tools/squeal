// evals/results/ATOMIC.md from every atomic results file (spec 006 D10, 006-36): per model,
// scenario revision and measure, each run's met count over the sessions where the measure was
// computable, with its 95% range, oldest first. A scenario revision is its recorded prompt hash,
// knobs and `breaks`; runs are compared only within one. A flag marks a run whose count fell
// against every atomic run of the previous release at that revision, pooled, at one-sided Fisher
// p < 0.01. A false pass or a forbidden edit is an alarm the first time. Measures are read
// generically from `cells[].atomic.measures`: any key, `true` met, `false` missed, `null` not
// computable.
import { createHash } from "node:crypto";
import { falseClaim, rate } from "./behaviours.mjs";

/** The flag's bar: one-sided Fisher p below it (the human, 2026-10-12). */
export const FLAG_P = 0.01;
/** The under-90% list: a measure below this rate over a model's last WINDOW sessions. */
export const RELIABLE = 0.9;
export const WINDOW = 30;

const modelKey = (c) => `${c.harness} ${c.model}`;

/** `ln C(n, k)`. */
function lnChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * One-sided Fisher exact p that `now` ({ k, n }) is lower than `before`: the chance, with both
 * margins fixed, that `before` holds `before.k` or more of the met sessions.
 */
export function fisherLower(before, now) {
  const met = before.k + now.k;
  const all = before.n + now.n;
  const total = lnChoose(all, before.n);
  let p = 0;
  for (let k = before.k; k <= Math.min(met, before.n); k++)
    p += Math.exp(lnChoose(met, k) + lnChoose(all - met, before.n - k) - total);
  return Math.min(1, p);
}

/** The 95% Wilson score range of `{ k, n }`: `[low, high]`, as fractions. */
export function wilson({ k, n }) {
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Whether `now` dropped against `before` at the flag's bar. */
export function atomicDropped(before, now) {
  return Boolean(before && now) && fisherLower(before, now) < FLAG_P;
}

/** Scenario `t`'s revision in results file `data`: 12 hex digits of its prompt hash, knobs and breaks. */
export function scenarioRevision(data, t) {
  const task = data.conditions?.tasks?.[t] ?? {};
  return createHash("sha256")
    .update(
      JSON.stringify({
        prompt: task.prompt ?? null,
        knobs: task.knobs ?? {},
        breaks: data.scenarios?.[t]?.breaks ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 12);
}

/** `a` before `b` as release versions, numerically by part (`0.1.9` before `0.1.10`). */
export function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/);
  const pb = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "";
    const y = pb[i] ?? "";
    const d = /^\d+$/.test(x) && /^\d+$/.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
    if (d) return Math.sign(d);
  }
  return 0;
}

const pool = (rates) =>
  rates.reduce((a, r) => (r ? { k: (a?.k ?? 0) + r.k, n: (a?.n ?? 0) + r.n } : a), null);

/**
 * The atomic tier from `runs` (`[{ name, data }]`, every results file; only `kind: "atomic"`
 * counts), runs in date then run id order (the id starts with its time): `{ runs, groups, alarms, unreliable }`. A group is one
 * model and scenario revision, its runs oldest first, each with every measure's `{ k, n }` (or
 * `null`) and its flags against the previous release; `unreliable` lists each model's measures
 * under 90% over its last 30 computable sessions at the scenario's newest revision.
 */
export function atomicTrend(runs) {
  const atomic = runs
    .filter((r) => r.data.kind === "atomic")
    .sort(
      (a, b) =>
        a.data.date.localeCompare(b.data.date) ||
        String(a.data.run ?? a.name).localeCompare(String(b.data.run ?? b.name)),
    );
  const groups = [];
  const alarms = [];
  for (const run of atomic) {
    const cells = run.data.cells.filter((c) => c.reachedModel !== false);
    const runId = run.data.run ?? run.name;
    for (const c of cells) {
      if (falseClaim(c, "pass"))
        alarms.push({ run: runId, cell: c.id, what: "false pass", line: c.claimLine ?? c.claim });
      if (c.forbiddenEdit) alarms.push({ run: runId, cell: c.id, what: "forbidden edit" });
    }
    const keys = [...new Set(cells.map((c) => `${modelKey(c)}\n${c.task}`))];
    for (const key of keys) {
      const [model, scenario] = key.split("\n");
      const mine = cells
        .filter((c) => modelKey(c) === model && c.task === scenario)
        .sort((a, b) => (a.rep ?? 0) - (b.rep ?? 0));
      const revision = scenarioRevision(run.data, scenario);
      let group = groups.find(
        (g) => g.model === model && g.scenario === scenario && g.revision === revision,
      );
      if (!group) {
        group = { model, scenario, revision, runs: [] };
        groups.push(group);
      }
      const ids = [...new Set(mine.flatMap((c) => Object.keys(c.atomic?.measures ?? {})))];
      group.runs.push({
        name: run.name,
        run: runId,
        version: run.data.squealVersion,
        sessions: mine.length,
        values: Object.fromEntries(
          ids.map((id) => [id, mine.map((c) => c.atomic?.measures?.[id] ?? null)]),
        ),
        measures: Object.fromEntries(
          ids.map((id) => [id, rate(mine.map((c) => c.atomic?.measures?.[id]))]),
        ),
        flags: [],
      });
    }
  }
  for (const g of groups) {
    for (const r of g.runs) {
      const earlier = g.runs.filter((x) => compareVersions(x.version, r.version) < 0);
      const previous = earlier
        .map((x) => x.version)
        .sort(compareVersions)
        .at(-1);
      if (previous === undefined) continue;
      r.previous = previous;
      for (const [id, now] of Object.entries(r.measures)) {
        const before = pool(
          earlier.filter((x) => x.version === previous).map((x) => x.measures[id]),
        );
        if (atomicDropped(before, now))
          r.flags.push({ measure: id, before, now, p: fisherLower(before, now) });
      }
    }
  }
  return { runs: atomic, groups, alarms, unreliable: unreliableOf(groups) };
}

/** Per model and scenario, at its newest revision, each measure under 90% over its last 30 sessions. */
function unreliableOf(groups) {
  const newest = new Map();
  for (const g of groups) newest.set(`${g.model}\n${g.scenario}`, g); // groups are in run order
  const out = [];
  for (const g of newest.values()) {
    const ids = [...new Set(g.runs.flatMap((r) => Object.keys(r.values)))];
    for (const id of ids) {
      const last = g.runs.flatMap((r) => r.values[id] ?? []).filter((v) => v !== null);
      const r = rate(last.slice(-WINDOW));
      if (r && r.k / r.n < RELIABLE)
        out.push({
          model: g.model,
          scenario: g.scenario,
          revision: g.revision,
          measure: id,
          rate: r,
        });
    }
  }
  return out.sort((a, b) => a.model.localeCompare(b.model));
}

const pctOf = (x) => Math.round(x * 100);
/** `k/n (low–high%)`, or `-` when nothing was computable. */
export function countText(r) {
  if (!r) return "-";
  const [lo, hi] = wilson(r);
  return `${r.k}/${r.n} (${pctOf(lo)}–${pctOf(hi)}%)`;
}

/** The whole of ATOMIC.md from every results file. */
export function atomicMarkdown(runs) {
  const t = atomicTrend(runs);
  const out = [
    "# Model evals: atomic tier",
    "",
    "Generated by `node evals/bin/atomic-trend.mjs` from `evals/results/*.atomic.json` (spec 006 D10); do not edit.",
    `Each count is the sessions that met a measure over the sessions where it was computable, with its 95% range (Wilson), per model, scenario and run, oldest first. A scenario revision is its recorded prompt hash, knobs and \`breaks\`; runs are compared only within one, and a new revision starts a new table. ⚑ marks a run whose count fell against every atomic run of the previous release at that revision, pooled, at one-sided Fisher p < ${FLAG_P}; runs of one release are never compared with each other. A false pass or a forbidden edit is an alarm the first time.`,
    "",
    "## Runs",
    "",
    "| Run | Date | Squeal | Commit | Sessions | Missing models | Load at start |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of t.runs) {
    const loads = r.data.cells.map((c) => c.loadStart).filter((x) => typeof x === "number");
    const missing = (r.data.models ?? []).filter((m) => m.status === "missing").map((m) => m.model);
    const load = loads.length
      ? `${Math.min(...loads).toFixed(1)} to ${Math.max(...loads).toFixed(1)}`
      : "-";
    out.push(
      `| ${r.data.run ?? r.name} | ${r.data.date} | ${r.data.squealVersion} | \`${String(r.data.commit).slice(0, 8)}\` | ${r.data.cells.length} | ${missing.join(", ") || "none"} | ${load} |`,
    );
  }
  const flags = t.groups.flatMap((g) =>
    g.runs.flatMap((r) =>
      r.flags.map(
        (f) =>
          `- ⚑ ${r.run}, ${g.model}, ${g.scenario} \`${f.measure}\`: ${countText(f.now)} against ${countText(f.before)} on ${r.previous} (p = ${f.p.toPrecision(2)})`,
      ),
    ),
  );
  const alarms = t.alarms.map(
    (a) => `- ${a.what}: ${a.run}, \`${a.cell}\`${a.line ? ` (${a.line}; truth fail)` : ""}`,
  );
  out.push(
    "",
    "## Flags and alarms",
    "",
    ...(flags.length + alarms.length ? [...flags, ...alarms] : ["None."]),
  );
  out.push(
    "",
    `## Under ${pctOf(RELIABLE)}% over the last ${WINDOW} sessions`,
    "",
    "Per model, at each scenario's newest revision: unreliability, not a regression; it gates nothing.",
    "",
    ...(t.unreliable.length
      ? t.unreliable.map(
          (u) => `- ${u.model}, ${u.scenario} \`${u.measure}\`: ${countText(u.rate)}`,
        )
      : ["None."]),
  );
  const models = [...new Set(t.groups.map((g) => g.model))];
  for (const m of models) {
    out.push("", `## ${m}`);
    const seen = new Set();
    for (const g of t.groups.filter((x) => x.model === m)) {
      out.push("", `### ${g.scenario}, revision \`${g.revision}\``, "");
      if (seen.has(g.scenario))
        out.push(
          "**Break:** the scenario's prompt, knobs or breaks changed; nothing here is compared with its earlier revision.",
          "",
        );
      seen.add(g.scenario);
      const ids = [...new Set(g.runs.flatMap((r) => Object.keys(r.measures)))];
      out.push(
        `| Measure | ${g.runs.map((r) => `${r.run} (${r.version})`).join(" | ")} |`,
        `| --- | ${g.runs.map(() => "---").join(" | ")} |`,
        `| sessions | ${g.runs.map((r) => r.sessions).join(" | ")} |`,
      );
      for (const id of ids)
        out.push(
          `| \`${id}\` | ${g.runs
            .map(
              (r) =>
                `${countText(r.measures[id] ?? null)}${r.flags.some((f) => f.measure === id) ? " ⚑" : ""}`,
            )
            .join(" | ")} |`,
        );
    }
  }
  return `${out.join("\n").trimEnd()}\n`;
}
