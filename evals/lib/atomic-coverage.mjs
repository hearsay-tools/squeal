// An atomic variant run's planned cells against the cells it kept (review
// exp-minimal-primer-design B2): a cell whose setup failed, that never reached its model or that
// was never run is missing from every count of its measures. The comparison names each such gap
// per model, scenario and arm, so no missing cell leaves a denominator without a word.
import { modelKey } from "./behaviours.mjs";

/**
 * The coverage of results file `data` for arms `arms`: `null` for a file that records no
 * `repetitions` (before 006-33); else `{ planned, rows, gaps, failed }`. `rows` has one entry per
 * model of the run (`models`, a stand-in under its own name), scenario it declared (`scenarios`)
 * and arm: `planned` the run's repetitions, `kept` its cells in the file, `reached` those that
 * reached the model. `gaps` are the rows with `reached < planned`; `failed` the run's failed cell
 * ids, which the file keeps apart.
 */
export function atomicCoverage(data, arms) {
  // Pooled runs (atomic-pool.mjs): each run's plan against its own cells, the rows added up.
  if (Array.isArray(data.parts)) {
    const each = data.parts.map((p) =>
      runCoverage({ ...p, cells: data.cells.filter((c) => c.run === p.run) }, arms),
    );
    return each.includes(null) ? null : summed(each);
  }
  return runCoverage(data, arms);
}

/**
 * Pooled runs' plans and coverage, one markdown line each, before the pooled tables (review
 * exp-minimal-primer-design-r3 B2): its file, run, repetitions, scenarios and models, its planned
 * and reached cells, and each of its gaps. None for one results file.
 */
export function partLines(data, arms) {
  if (!Array.isArray(data.parts)) return [];
  return data.parts.map((p) => {
    const cov = runCoverage({ ...p, cells: data.cells.filter((c) => c.run === p.run) }, arms);
    const models = p.models.map((m) => modelKey({ ...m, model: m.standIn ?? m.model }));
    const plan = `\`${p.name}\` (run ${p.run}): ${p.repetitions ?? "?"} repetition${p.repetitions === 1 ? "" : "s"} of ${Object.keys(p.scenarios).join(", ")} for ${models.join(", ")}, both arms`;
    if (cov === null)
      return `- ${plan}; it records no repetitions, so its coverage is not checked.`;
    const reached = cov.rows.reduce((n, r) => n + r.reached, 0);
    const gaps = cov.gaps.map(
      (g) => `${g.model} ${g.scenario} ${g.arm} ${g.reached} of ${g.planned}`,
    );
    return `- ${plan}: ${reached} of ${cov.planned} planned cells reached their model${gaps.length ? `; short: ${gaps.join("; ")}` : ", complete"}.`;
  });
}

/** The rows of `parts`' coverages added up by model, scenario and arm. */
function summed(parts) {
  const rows = new Map();
  for (const r of parts.flatMap((p) => p.rows)) {
    const key = `${r.model}\n${r.scenario}\n${r.arm}`;
    const o = rows.get(key);
    rows.set(
      key,
      o
        ? {
            ...o,
            planned: o.planned + r.planned,
            kept: o.kept + r.kept,
            reached: o.reached + r.reached,
          }
        : r,
    );
  }
  const all = [...rows.values()];
  return {
    planned: all.reduce((n, r) => n + r.planned, 0),
    rows: all,
    gaps: all.filter((r) => r.reached < r.planned),
    failed: parts.flatMap((p) => p.failed),
  };
}

/** One run's coverage: its repetitions for each of its models, scenarios and the arms. */
function runCoverage(data, arms) {
  if (typeof data.repetitions !== "number") return null;
  const models = (data.models ?? []).map((m) => modelKey({ ...m, model: m.standIn ?? m.model }));
  const rows = [];
  for (const model of models)
    for (const scenario of Object.keys(data.scenarios ?? {}))
      for (const arm of arms) {
        const mine = data.cells.filter(
          (c) => modelKey(c) === model && c.task === scenario && c.variant === arm,
        );
        rows.push({
          model,
          scenario,
          arm,
          planned: data.repetitions,
          kept: mine.length,
          reached: mine.filter((c) => c.reachedModel !== false).length,
        });
      }
  return {
    planned: rows.reduce((n, r) => n + r.planned, 0),
    rows,
    gaps: rows.filter((r) => r.reached < r.planned),
    failed: (data.failed ?? []).map((f) => f.id ?? String(f)),
  };
}

/** The coverage as markdown lines: complete in one line, else each gap and the failed cells. */
export function coverageLines(cov) {
  if (cov === null) return ["Coverage: the results record no repetitions, so it is not checked."];
  const reached = cov.rows.reduce((n, r) => n + r.reached, 0);
  if (cov.gaps.length === 0)
    return [`Coverage: complete, ${reached} of ${cov.planned} planned cells reached their model.`];
  return [
    `**Coverage: incomplete.** ${reached} of ${cov.planned} planned cells reached their model; each count below is over the cells that did. Read no difference before these gaps are explained.`,
    "",
    "| Model | Scenario | Arm | Planned | Kept | Reached |",
    "| --- | --- | --- | --- | --- | --- |",
    ...cov.gaps.map(
      (g) => `| ${g.model} | ${g.scenario} | ${g.arm} | ${g.planned} | ${g.kept} | ${g.reached} |`,
    ),
    ...(cov.failed.length ? ["", `Failed cells: ${cov.failed.join(", ")}.`] : []),
  ];
}
