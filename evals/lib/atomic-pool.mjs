// Several atomic variant runs of one commit and one pair of arms, pooled into one comparison
// (row 005-127: a staged run, Sol first, then more repetitions of one scenario or another model,
// each a results file of its own). Cells are pooled only where their conditions match; anything
// else throws, naming the difference, so no comparison mixes two situations.
import { modelKey } from "./behaviours.mjs";

/**
 * Results files `parts` (`[{ name, data }]`, each `kind: "atomic-variant"`) as one: the cells
 * of all, each tagged with its `run`, the failed cells of all, the union of their scenarios and
 * models, and `parts` (`{ run, name, repetitions, models, scenarios, failed, harnesses }`), from
 * which the coverage counts each run's plan apart. One file is returned as it is, once its cell
 * ids are checked. Throws unless every file names the same commit, the same two arms and the
 * same effort and fixture per arm; unless every scenario that more than one file holds has the
 * same prompt and knobs in each arm in all of them, whatever their order (review
 * exp-minimal-primer-design-r3 B2); and when two files are one run (the same run id: one file
 * given twice, or a copy) or a run holds one cell id twice. A cell id names its repetition, not
 * its run, so two runs of one scenario hold the same ids, as different sessions.
 */
export function poolAtomicRuns(parts) {
  if (parts.length === 0) throw new Error("no results file to compare");
  for (const { name, data } of parts) uniqueCells(name, data);
  if (parts.length === 1) return parts[0].data;
  const [{ data: first, name: firstName }] = parts;
  for (const { name, data } of parts.slice(1)) sameRunKind(first, firstName, data, name);
  sameScenarios(parts);
  distinctRuns(parts);
  const merged = (field) => Object.assign({}, ...parts.map(({ data }) => data[field]?.tasks ?? {}));
  const models = new Map();
  for (const { data } of parts)
    for (const m of data.models ?? [])
      models.set(modelKey({ ...m, model: m.standIn ?? m.model }), m);
  return {
    ...first,
    run: parts.map(({ data }) => data.run).join("+"),
    conditions: { ...first.conditions, tasks: merged("conditions") },
    variantConditions: { ...first.variantConditions, tasks: merged("variantConditions") },
    scenarios: Object.assign({}, ...parts.map(({ data }) => data.scenarios ?? {})),
    models: [...models.values()],
    cells: parts.flatMap(({ data }) => data.cells.map((c) => ({ ...c, run: data.run }))),
    failed: parts.flatMap(({ data }) => data.failed ?? []),
    parts: parts.map(({ name, data }) => ({
      run: data.run,
      name,
      repetitions: data.repetitions,
      models: data.models ?? [],
      scenarios: data.scenarios ?? {},
      failed: data.failed ?? [],
      harnesses: data.harnesses ?? {},
    })),
  };
}

/** Throws unless run `b` (file `bn`) is an atomic variant run of run `a`'s (file `an`) commit, arms, effort and fixtures. */
function sameRunKind(a, an, b, bn) {
  const differ = (what) => {
    throw new Error(`${bn} cannot be pooled with ${an}: ${what}`);
  };
  if (a.kind !== "atomic-variant" || b.kind !== "atomic-variant")
    differ("only atomic variant runs pool");
  if (a.commit !== b.commit) differ(`commit ${b.commit} against ${a.commit}`);
  for (const arm of ["conditions", "variantConditions"]) {
    const [x, y] = [a[arm] ?? {}, b[arm] ?? {}];
    if (x.variant !== y.variant) differ(`arm ${y.variant} against ${x.variant}`);
    if (x.effort !== y.effort) differ(`effort ${y.effort} against ${x.effort}`);
    if (x.fixture !== y.fixture) differ(`fixture of arm ${x.variant}`);
  }
}

/** Throws when two files hold one scenario with another prompt or knobs in one arm, in any order. */
function sameScenarios(parts) {
  for (const arm of ["conditions", "variantConditions"]) {
    const seen = new Map(); // scenario -> { text, name }
    for (const { name, data } of parts)
      for (const [t, c] of Object.entries(data[arm]?.tasks ?? {})) {
        const text = JSON.stringify(c);
        const o = seen.get(t);
        if (!o) seen.set(t, { text, name });
        else if (o.text !== text)
          throw new Error(
            `${name} cannot be pooled with ${o.name}: scenario ${t}'s prompt or knobs in arm ${data[arm].variant}`,
          );
      }
  }
}

/** Throws when two files are one run. */
function distinctRuns(parts) {
  const seen = new Map();
  for (const { name, data } of parts) {
    const o = seen.get(data.run);
    if (o !== undefined)
      throw new Error(
        `${name} and ${o} are the same run ${data.run}: its sessions would count twice`,
      );
    seen.set(data.run, name);
  }
}

/** Throws when file `name` holds one cell id twice. */
function uniqueCells(name, data) {
  const ids = new Set();
  for (const c of data.cells ?? []) {
    if (ids.has(c.id)) throw new Error(`${name} holds cell ${c.id} twice`);
    ids.add(c.id);
  }
}

/** A markdown line naming the pooled runs, and each run's harness versions where they differ. */
export function pooledLines(data) {
  if (!Array.isArray(data.parts)) return [];
  const versions = data.parts.map((p) => JSON.stringify(p.harnesses));
  const lines = [
    `Pooled from ${data.parts.length} runs of one commit and one pair of arms: ${data.parts.map((p) => `\`${p.name}\``).join(", ")}.`,
  ];
  if (new Set(versions).size > 1)
    lines.push(
      `The runs used different harness versions: ${data.parts
        .map(
          (p) =>
            `${p.run} ${Object.entries(p.harnesses)
              .map(([h, v]) => `${h} ${v}`)
              .join(", ")}`,
        )
        .join("; ")}. Read a pooled count with that in mind.`,
    );
  return lines;
}
