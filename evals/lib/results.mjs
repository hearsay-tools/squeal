// A baseline run's results file (spec 006 D6): the commit, the versions, the conditions and
// every cell's grade, compact. Committed, so it holds no transcript text beyond the claim line.
import { createHash } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");

/**
 * The conditions a trend line holds fixed: the fixture commit, each task's prompt (hashed) and
 * knobs, the variant and the effort level. Squeal, harness and model versions are left out:
 * they are what the trend tracks. `fingerprint` is the first 12 hex digits of their hash.
 */
export function conditionsOf({ fixture, tasks, variant, effort }) {
  const sorted = Object.fromEntries(
    Object.keys(tasks)
      .sort()
      .map((id) => [
        id,
        { prompt: sha(tasks[id].prompt).slice(0, 12), knobs: tasks[id].knobs ?? {} },
      ]),
  );
  const body = { fixture, tasks: sorted, variant, effort };
  return { ...body, fingerprint: sha(JSON.stringify(body)).slice(0, 12) };
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
    reachedModel: g.reachedModel ?? true,
    wallS: g.wallS,
    loadStart: g.load?.start ?? null,
    loadMax: g.load?.max ?? null,
    costUsd: g.cost ?? null,
    tokens: g.usage
      ? {
          input: g.usage.input_tokens ?? null,
          cached: g.usage.cached_input_tokens ?? g.usage.cache_read_input_tokens ?? null,
          output: g.usage.output_tokens ?? null,
        }
      : null,
    edits: g.edits,
    vitestRuns: g.vitestRuns,
    vitestFull: g.vitestByScope?.full ?? 0,
    vitestAfterLastEdit: g.vitestAfterLastEdit,
    vitestAfterSquealAnswered: g.vitestAfterSquealAnswered ?? null,
    nodeTestRuns: g.nodeTestRuns,
    nodeTestAfterScriptEdit: g.nodeTestAfterScriptEdit ?? null,
    testAttemptsRefused: g.testAttemptsRefused ?? 0,
    squealWaits: g.squealWaits,
    waitsAfterLastEdit: g.waitsAfterLastEdit,
    sleeps: g.sleeps,
    skillLoads: g.skillLoads,
    squealWhy: g.squealWhy,
    squealRunSlow: g.squealRunSlow,
    failDeliveries: g.deliveries?.fail ?? null,
    tempFileHeaders: g.tempFileHeaders ?? null,
    forbiddenEdit: g.forbiddenEdit,
    claim: g.claim,
    claimLine: g.claimLine,
    truthPass: g.truth?.pass ?? null,
    claimTrue: g.claimTrue,
    claimMatchesSqueal: g.claimMatchesSqueal ?? null,
    squealVerdict: g.squealEnd?.verdict ?? null,
    daemonKilled: (g.daemonExits ?? []).filter((e) => e.signal).length,
    leftovers: g.leftovers ?? 0,
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

/** A run's results file name: `<date>-<version>.<run>[.<variant>].json`, one per run. */
export function resultsName({ date, version, run, variant = null }) {
  return `${date}-${version}.${run}${variant ? `.${variant}` : ""}.json`;
}
