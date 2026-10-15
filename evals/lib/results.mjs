// A baseline run's results file (spec 006 D6): the commit, the versions, the conditions and
// every cell's grade, compact. Committed, so the only transcript text it holds is the claim line
// and the judge's numbered, trimmed transcript (D9), redacted before the judge reads it.
import { createHash } from "node:crypto";

/** The sha256 of `s`, in hex. */
export const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * The conditions a trend line holds fixed: the fixture commit, each task's prompt (hashed) and
 * knobs, the variant, the effort level and, when given, each harness's tool allow-list (added
 * 2026-10-12 with `Skill`; runs before it name none). Squeal, harness and model versions are left
 * out: they are what the trend tracks. `fingerprint` is the first 12 hex digits of their hash.
 */
export function conditionsOf({ fixture, tasks, variant, effort, tools }) {
  const sorted = Object.fromEntries(
    Object.keys(tasks)
      .sort()
      .map((id) => [
        id,
        { prompt: sha(tasks[id].prompt).slice(0, 12), knobs: tasks[id].knobs ?? {} },
      ]),
  );
  const body = { fixture, tasks: sorted, variant, effort, ...(tools ? { tools } : {}) };
  return { ...body, fingerprint: sha(JSON.stringify(body)).slice(0, 12) };
}

/**
 * `config` narrowed to the `models` and `tasks` named (lists, or null for all), for a run of part
 * of the suite (006-45); throws on a name the config does not hold. The results then name only
 * the models that ran, and a baseline's narrowed tasks change its conditions.
 */
export function narrowed(config, { models = null, tasks = null } = {}) {
  const pick = (all, names, key, flag) => {
    if (!names) return all;
    const unknown = names.filter((n) => !all.some((x) => key(x) === n));
    if (unknown.length) throw new Error(`${flag}: not in the config: ${unknown.join(", ")}`);
    return all.filter((x) => names.includes(key(x)));
  };
  return {
    ...config,
    models: pick(config.models, models, (m) => m.model, "--models"),
    tasks: pick(config.tasks, tasks, (t) => t, "--tasks"),
  };
}

/** One cell's grade as the results file keeps it. */
export function cellRecord(g) {
  return {
    id: g.id,
    task: g.task,
    variant: g.variant,
    harness: g.harness,
    model: g.model,
    effort: g.effort,
    effortReported: g.effortReported ?? null,
    rep: g.rep,
    // 006-62: the cell's bare `squeal` was the pinned plugin's; cells before it name none.
    ...(g.squealPath ? { squealPath: g.squealPath } : {}),
    reachedModel: g.reachedModel ?? true,
    wallS: g.wallS,
    loadStart: g.load?.start ?? null,
    costUsd: g.cost ?? null,
    tokens: g.usage
      ? {
          input: g.usage.input_tokens ?? null,
          cached: g.usage.cached_input_tokens ?? g.usage.cache_read_input_tokens ?? null,
          output: g.usage.output_tokens ?? null,
        }
      : null,
    edits: g.edits,
    vitestFull: g.vitestByScope?.full ?? 0,
    testAttemptsRefused: g.testAttemptsRefused ?? 0,
    squealWaits: g.squealWaits,
    waitsAfterLastEdit: g.waitsAfterLastEdit,
    sleeps: g.sleeps,
    skillLoads: g.skillLoads,
    squealWhy: g.squealWhy,
    squealRunSlow: g.squealRunSlow,
    forbiddenEdit: g.forbiddenEdit,
    claim: g.claim,
    claimLine: g.claimLine,
    truthPass: g.truth?.pass ?? null,
    claimTrue: g.claimTrue,
    claimMatchesSqueal: g.claimMatchesSqueal ?? null,
    squealVerdict: g.squealEnd?.verdict ?? null,
    leftovers: g.leftovers ?? 0,
    // D4 "Retained evidence": what the timeline rules read, so a later rule regrades from it.
    timeline: g.retained ?? null,
    // D9: the transcript the judge read and its verdicts, cached by the transcript's hash and the
    // judge's identity; `null` for a cell never judged, whose judged four are not computable.
    transcript: g.transcript ?? null,
    judge: g.judge ?? null,
    // The frozen parser's grade of the judged four, kept beside the judge's (D9).
    parser: g.parser ?? null,
  };
}

/** Throws when `text` holds any of `secrets`: a results file is committed to a public repository. */
export function assertNoSecrets(text, secrets) {
  const n = secrets.filter((s) => text.includes(s)).length;
  if (n)
    throw new Error(`the results hold ${n} secret value(s) (a provider URL or token); not written`);
}

/**
 * Each arm's fixture commit from the graded cells (`{ variant, head }`): `{ [arm]: head }`, null
 * for an arm with no graded cell. An arm's instructions and policy are committed into its
 * fixture, so arms differ by design; cells of one arm that differ are drift, and throw.
 */
export function armFixtures(grades, arms) {
  return Object.fromEntries(
    arms.map((arm) => {
      const heads = [...new Set(grades.filter((g) => g.variant === arm).map((g) => g.head))];
      if (heads.length > 1)
        throw new Error(`arm ${arm} ran on ${heads.length} fixture commits: ${heads.join(", ")}`);
      return [arm, heads[0] ?? null];
    }),
  );
}

/**
 * A run's results file name, one per run: `<date>-<version>.<run>[.<variant>].json`, or for an
 * atomic run `<date>-<version>.<run>.atomic.json` and `<date>-<version>.<run>.<variant>.atomic-variant.json`.
 */
export function resultsName({ date, version, run, variant = null, atomic = false }) {
  const suffix = atomic
    ? variant
      ? `.${variant}.atomic-variant`
      : ".atomic"
    : variant
      ? `.${variant}`
      : "";
  return `${date}-${version}.${run}${suffix}.json`;
}

/**
 * Results file notes `regraded` with `note` added for a regrade that changed cells (006-86), the
 * one rule every regrade stamps by. An earlier note by the same row (and, for the expectations
 * pass, the same revision) is replaced: its `changed` cells are kept in the new note's, and where
 * the note keeps an `evidence` list (`regrade-cells.mjs`), its cells too, less any now in
 * `changed`.
 */
export function stamped(regraded = [], note) {
  const earlier = regraded.find((n) => n.by === note.by && n.revision === note.revision);
  const changed = [...new Set([...(earlier?.changed ?? []), ...note.changed])];
  const next = { ...note, changed };
  if (note.evidence)
    next.evidence = [...new Set([...(earlier?.evidence ?? []), ...note.evidence])].filter(
      (id) => !changed.includes(id),
    );
  return [...regraded.filter((n) => n !== earlier), next];
}
