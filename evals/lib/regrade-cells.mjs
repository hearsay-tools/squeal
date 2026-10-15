// Row 006-82: a committed results file's cells graded again from their kept raw `out/`, with the
// parser at this revision, as evals/bin/grade.mjs grades a new cell. `regrade.mjs` and
// `atomic-regrade.mjs` re-read the timeline kept at grading time, already reduced by the parser
// of that day, so a parser fix reaches no committed result through them. No model call: a long
// cell keeps its transcript and judge verdicts; only the mechanical fields, `parser`, the
// expectations and an atomic cell's pilot record change.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pilotRecord } from "./atomic-measures.mjs";
import { expectationsOf, parserOf } from "./behaviours.mjs";
import { gradeCell, serviceStartsOf } from "./grade.mjs";
import { cellRecord } from "./results.mjs";
import { claudeTimeline, codexTimeline, reportedEffort } from "./transcript.mjs";
import { walk } from "./variant.mjs";

const VARIANTS = join(import.meta.dirname, "../variants");

const jsonl = (f) =>
  existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/**
 * The grade evals/bin/grade.mjs computes from cell directory `out` (its meta, events, harness
 * records, ground truth, Squeal's end state, diff and service starts), without writing it; `null`
 * when `out` kept no `meta.json` or `events.jsonl`.
 */
export function gradeOut(out) {
  if (!existsSync(join(out, "meta.json")) || !existsSync(join(out, "events.jsonl"))) return null;
  const read = (f) => (existsSync(join(out, f)) ? readFileSync(join(out, f), "utf8") : "");
  const readJson = (f) => {
    try {
      return JSON.parse(read(f));
    } catch {
      return undefined;
    }
  };
  const meta = JSON.parse(read("meta.json"));
  const events = jsonl(join(out, "events.jsonl"));
  const t0 = Number(read("t0"));
  const records = walk(join(out, "harness"))
    .filter((f) => f.endsWith(".jsonl"))
    .flatMap(jsonl);
  const timeline =
    meta.harness === "claude" ? claudeTimeline(events) : codexTimeline(events, records, t0);
  const truth = ["truth.json", "truth.vitest.json", "truth.txt"].some((f) =>
    existsSync(join(out, f)),
  )
    ? { vitest: readJson("truth.vitest.json"), completion: readJson("truth.json") }
    : null;
  const variantFile = join(VARIANTS, `${meta.variant}.json`);
  const plugin =
    !existsSync(variantFile) || JSON.parse(readFileSync(variantFile, "utf8")).plugin !== false;
  return {
    ...meta,
    effortReported: reportedEffort(meta.harness, records),
    ...gradeCell({
      timeline,
      truth,
      statusEnd: read("status-end.json") || null,
      plugin,
      diff: read("diff.patch"),
      serviceStarts: existsSync(join(out, "service-starts.txt"))
        ? serviceStartsOf(read("service-starts.txt"), t0)
        : null,
    }),
  };
}

/**
 * The fields of a results cell (`cellRecord`'s) that `gradeCell` sets, refreshed from `out/`. The
 * run's own record (identity, wall time, cost, tokens, leftovers) and the judge's (`transcript`,
 * `judge`) are kept as committed.
 */
export const MECHANICAL = [
  "edits",
  "vitestFull",
  "testAttemptsRefused",
  "squealWaits",
  "waitsAfterLastEdit",
  "sleeps",
  "skillLoads",
  "squealWhy",
  "squealRunSlow",
  "forbiddenEdit",
  "claim",
  "claimLine",
  "truthPass",
  "claimTrue",
  "claimMatchesSqueal",
  "squealVerdict",
  "timeline",
];

/**
 * Committed `cell` graded again from `grade` (`gradeOut`'s): its mechanical fields; for a long
 * cell its `parser` beside a kept judge verdict and its expectations; for an atomic cell of a
 * scenario `config` declares, its pilot record under that declaration, with the turns and settles
 * the run recorded.
 */
export function regradedCell(cell, grade, { conditions, declared, config }) {
  const fresh = cellRecord({ ...grade, id: cell.id });
  const next = { ...cell, ...Object.fromEntries(MECHANICAL.map((k) => [k, fresh[k]])) };
  if (cell.atomic) {
    const scenario = config.scenarios[cell.task];
    if (scenario) {
      const { turns, turnStarts, settle } = cell.atomic;
      next.atomic = {
        ...cell.atomic,
        ...pilotRecord(grade, { turns, turnStarts, settle, scenario }),
      };
    }
    return next;
  }
  if (cell.judge) next.parser = parserOf(next, conditions, declared);
  if (cell.expectations !== undefined)
    next.expectations = expectationsOf(next, conditions, declared);
  return next;
}

/** Each top-level field of `a` and `b` that differs, as `[field, before, after]`. */
const differences = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => [k, a[k], b[k]]);

/** The fields that grade a cell; its other mechanical fields are the evidence they read. */
const GRADED = ["claim", "truthPass", "claimTrue", "claimMatchesSqueal", "squealVerdict"];
/** The per-id grades a field holds: an atomic record's measures, `parser`, `expectations`. */
const PER_ID = {
  atomic: (v) => v?.measures ?? {},
  parser: (v) => v ?? {},
  expectations: (v) => v ?? {},
};

/**
 * What changed between committed cell `before` and `after`: `grades`, each changed grade as
 * `[name, before, after]` (`atomic claim-after-retry`, `parser no-overclaim`, `claimTrue`), and
 * `evidence`, the other changed fields' names.
 */
export function changesOf(before, after) {
  const grades = [];
  const evidence = [];
  for (const [k, b, a] of differences(before, after)) {
    const per = PER_ID[k];
    if (per) {
      const [pb, pa] = [per(b), per(a)];
      const ids = Object.keys({ ...pb, ...pa }).filter(
        (m) => JSON.stringify(pb[m]) !== JSON.stringify(pa[m]),
      );
      for (const m of ids) grades.push([`${k} ${m}`, pb[m], pa[m]]);
      if (k === "atomic" && !ids.length) evidence.push(k);
    } else if (GRADED.includes(k)) grades.push([k, b, a]);
    else evidence.push(k);
  }
  return { grades, evidence };
}

/**
 * Results file `data` with every cell `gradeOf(cell)` has a grade for graded again
 * (`regradedCell`). A cell without one (its `out/` is gone) stays as committed and is listed in
 * `missing`. Only when a cell's stored fields changed is the file's `regraded` note `{ by, date,
 * changed, evidence, note }` added, replacing an earlier note by the same row: `changed` the cells
 * whose grade changed (claim fields, expectations, `parser`, measures), as every regrade note
 * names them, `evidence` those whose stored evidence (timeline or counts) changed alone. With
 * none, `data` is returned as it was. `diffs` gives each changed cell's `changesOf`.
 */
export function regradeFromOut(data, { gradeOf, declared, config, by, note, date }) {
  if (!by || !note) throw new Error("a regrade names its row (`by`) and its note");
  const changed = [];
  const evidence = [];
  const missing = [];
  const diffs = [];
  const cells = data.cells.map((cell) => {
    const grade = gradeOf(cell);
    if (grade === null) {
      missing.push(cell.id);
      return cell;
    }
    const next = regradedCell(cell, grade, { conditions: data.conditions, declared, config });
    if (JSON.stringify(cell) === JSON.stringify(next)) return cell;
    const diff = { id: cell.id, ...changesOf(cell, next) };
    (diff.grades.length ? changed : evidence).push(cell.id);
    diffs.push(diff);
    return next;
  });
  if (!diffs.length) return { data, changed, evidence, missing, diffs };
  const earlier = (data.regraded ?? []).find((n) => n.by === by);
  const others = (data.regraded ?? []).filter((n) => n !== earlier);
  const graded = [...new Set([...(earlier?.changed ?? []), ...changed])];
  const kept = [...new Set([...(earlier?.evidence ?? []), ...evidence])].filter(
    (id) => !graded.includes(id),
  );
  const stamp = { by, date, changed: graded, evidence: kept, note };
  return {
    data: { ...data, cells, regraded: [...others, stamp] },
    changed,
    evidence,
    missing,
    diffs,
  };
}

/**
 * The run directory `run` under kept-cells root `root` (`<root>/<run>` or `<root>/<any>/<run>`,
 * as run-baseline keeps them), or `null` without one. Two are a refusal: which is the run's is
 * not known.
 */
export function runDirOf(root, run) {
  const found = [join(root, run)];
  for (const e of readdirSync(root, { withFileTypes: true }))
    if (e.isDirectory()) found.push(join(root, e.name, run));
  const dirs = found.filter((d) => existsSync(d));
  if (dirs.length > 1) throw new Error(`run ${run} is kept twice: ${dirs.join(", ")}`);
  return dirs[0] ?? null;
}
