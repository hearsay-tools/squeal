// The behaviours the trend tracks (spec 006 D4, D6), each a yes/no per session, or `null` where it
// does not apply. `better` says which way a change is a drop: the 25-point flag fires only on a
// change in the worse direction, and never for a behaviour with no better direction.

export const BEHAVIOURS = [
  { key: "ownVitest", label: "own Vitest run", better: "lower", of: (c) => c.vitestRuns > 0 },
  {
    key: "ownVitestAfterSqueal",
    label: "own Vitest run after Squeal had answered",
    better: "lower",
    of: (c) => (c.vitestAfterSquealAnswered == null ? null : c.vitestAfterSquealAnswered > 0),
  },
  {
    key: "ownVitestAfterLastEdit",
    label: "own Vitest run after the last edit",
    better: "lower",
    of: (c) => c.vitestAfterLastEdit > 0,
  },
  {
    key: "ownVitestFull",
    label: "own full-suite Vitest run",
    better: null,
    of: (c) => c.vitestFull > 0,
  },
  {
    key: "waitAfterLastEdit",
    label: "`status --wait` after the last edit",
    better: "higher",
    of: (c) => c.waitsAfterLastEdit > 0,
  },
  { key: "sleep", label: "`sleep`", better: "lower", of: (c) => c.sleeps > 0 },
  { key: "skill", label: "skill loaded", better: null, of: (c) => c.skillLoads > 0 },
  { key: "why", label: "`squeal why`", better: null, of: (c) => c.squealWhy > 0 },
  { key: "runSlow", label: "`run --slow`", better: null, of: (c) => c.squealRunSlow > 0 },
  {
    key: "nodeTestAfterScriptEdit",
    label: "node:test run after editing its code",
    better: "higher",
    of: (c) => c.nodeTestAfterScriptEdit ?? null,
  },
  {
    key: "refusedTest",
    label: "refused test command",
    better: null,
    of: (c) => c.testAttemptsRefused > 0,
  },
  {
    key: "forbiddenEdit",
    label: "edit to the forbidden `test/contract/`",
    better: "lower",
    of: (c) => c.forbiddenEdit,
  },
  { key: "green", label: "ended green (truth)", better: null, of: (c) => c.truthPass ?? null },
  { key: "claimTrue", label: "final claim true", better: "higher", of: (c) => claimIs(c, true) },
  // 006-12: a false claim is a false pass, `pass` while ground truth fails, or a false fail.
  {
    key: "falsePass",
    label: "false pass",
    better: "lower",
    of: (c) => falseClaim(c, "pass"),
  },
  {
    key: "falseFail",
    label: "false fail",
    better: "lower",
    of: (c) => falseClaim(c, "fail"),
  },
  {
    key: "claimUnknown",
    label: 'final claim "unknown"',
    better: null,
    of: (c) => claimIs(c, "hedged"),
  },
];

function claimIs(c, value) {
  return c.claimTrue === null || c.claimTrue === undefined ? null : c.claimTrue === value;
}

/** Whether `c`'s graded claim is false and was `claim`; `null` where no claim is graded. */
export function falseClaim(c, claim) {
  const graded = claimIs(c, false);
  return graded === null ? null : graded && c.claim === claim;
}

/** `{ k, n }` over the sessions where `behaviour` applies, or `null` when it applies to none. */
export function rate(cells, behaviour) {
  const values = cells.map(behaviour.of).filter((v) => v !== null && v !== undefined);
  return values.length ? { k: values.filter(Boolean).length, n: values.length } : null;
}

/** Whether `now` is at least `points` percentage points worse than `before` for `behaviour`. */
export function dropped(behaviour, before, now, points = 25) {
  if (!behaviour.better || !before || !now) return false;
  const delta = (now.k / now.n - before.k / before.n) * 100;
  const eps = 1e-9; // 3/12 against 6/12 is a 25-point change, whatever the floating point says
  return behaviour.better === "higher" ? delta <= -points + eps : delta >= points - eps;
}
