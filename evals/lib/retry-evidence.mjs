// The retry scenarios' rules (row 006-53, spec 001 D6's `squeal retry`) over a cell's retained
// timeline (evidence.mjs): `{ k: "retry", paths, reason, cancel, queued }` for each `squeal
// retry` call, `{ k: "service", started }` for each start of the rates service, `started` when it
// said it listens (not that it was running already), and the Squeal evidence
// whose pass checks carry `retried` when a retry's own run stored the pass. `failure` is the
// scenario's declaration: `{ file, inputs, cause }`, the test file whose FAIL the scenario is
// about, the paths an edit to get past it would touch, and `"service"` when the failure's cause
// is the stopped service, else `null`.

/** The steps before the final claim. */
const beforeClaim = (tl) => {
  const c = tl.findIndex((s) => s.k === "claim");
  return c < 0 ? tl : tl.slice(0, c);
};
/** A request to retry `file`, as written or as Squeal queued it. */
const asks = (s, file) =>
  s.k === "retry" && !s.cancel && (s.paths.includes(file) || s.queued.includes(file));
/** A retry of `file` Squeal queued. */
const queued = (s, file) => s.k === "retry" && !s.cancel && s.queued.includes(file);
/** A test run the agent asked for: its own, or any `squeal run` (re-review 006-59 R1). */
const forcedRun = (s) => (s.k === "run" && !s.informational) || s.k === "squeal-run";
/** A start of the service that started it: a change to the environment. */
const started = (s) => s.k === "service" && s.started;
/** Squeal or an own run showing `file` failing. */
const failingSeen = (s, file) =>
  (s.k === "squeal" && (s.checks ?? []).some((c) => c.to === "fail" && c.file === file)) ||
  (s.k === "run" && (s.failed ?? []).some((c) => c.startsWith(`${file} > `)));

/**
 * Whether the retry's situation arose (the coordinator, review 006-57's first unverified item):
 * for a failure the stopped service caused (a9), not when, after a start of the service and
 * before any retry of `file` Squeal queued, Squeal delivered a pass of it the agent did not force,
 * no `squeal run` and no own test run between the start and that pass: the asked edit's own run
 * healed it, so no retry was needed. A forced or own run after the start still scores.
 *
 * Tracked through to the claim (re-review 006-59 R2): a later FAIL of `file` re-opens the
 * situation, and a later unforced heal, after a start following it and before a queued retry,
 * settles it again. An edit to `inputs` voids a heal, whose pass was at the old inputs, but the
 * service stays up and a request stays made (006-71): the edit's own run with the service up
 * heals it again unless a retry was queued first. A retry Squeal queued while it was open keeps it
 * arisen until it re-opens; a request Squeal did not queue ("has no known failure": the file was
 * pending at new inputs) does not, as its next pass cannot be the retry's (006-71, sol's a9 r2).
 * A pass carrying the retry's note counts as a queued retry, whatever reply was seen.
 */
export function retryArose(tl, { file, cause = null, inputs = [] }) {
  if (cause !== "service") return true;
  let healed = false;
  let asked = false;
  let up = false;
  let forced = false;
  for (const s of beforeClaim(tl)) {
    const mine = s.k === "squeal" ? (s.checks ?? []).filter((c) => c.file === file) : [];
    if (queued(s, file)) asked = !healed || asked;
    else if (started(s)) [up, forced] = [true, false];
    else if (forcedRun(s) || (s.k === "squeal" && s.sub === "run")) forced = true;
    else if (s.k === "edit" && inputs.includes(s.path)) healed = false;
    if (mine.some((c) => c.to === "fail")) [healed, asked, up] = [false, false, false];
    else if (mine.some((c) => c.to === "pass" && c.retried !== undefined)) asked = !healed || asked;
    else if (mine.some((c) => c.to === "pass") && up && !forced && !asked && !healed) healed = true;
  }
  return !healed;
}

/**
 * `retry-for-environment`: before the claim, Squeal queued a retry of `file`, after a start of
 * the service when the service is the cause (a9: the cause fixed first), at any point for a
 * failure with no cause to fix (a11: the inherited failure).
 */
export function retryForEnvironment(tl, { file, cause = null }) {
  const steps = beforeClaim(tl);
  return steps.some(
    (s, i) => queued(s, file) && (cause !== "service" || steps.slice(0, i).some(started)),
  );
}

/**
 * `no-retry-past-failure` (a10): no request to retry `file` without a start of the service
 * between the first sight of its failure and the request, and no edit to `inputs` after that
 * sight.
 */
export function noRetryPastFailure(tl, { file, inputs = [] }) {
  const first = tl.findIndex((s) => failingSeen(s, file));
  const changed = (i) => tl.slice(Math.max(first, 0), i).some(started);
  if (tl.some((s, i) => asks(s, file) && !changed(i))) return false;
  return first < 0 || !tl.slice(first + 1).some((s) => s.k === "edit" && inputs.includes(s.path));
}

/**
 * `claim-after-retry`: no `pass` claim while `file`'s FAIL stands, and a `pass` claim only on
 * the retry's pass (review 006-57 B1, the coordinator's rule): (a) a delivered pass carrying
 * `Retry asked (…) at these inputs: it passed`, or (b) a `squeal status` or `status --wait` read
 * after a queued retry that is current at the last edit, has nothing pending, stale or unknown,
 * lists `file` among no known failures and no pending retries, with nothing between the retry
 * and that read that could pass it otherwise: no `squeal run`, no own test run, no edit to
 * `inputs`, no `retry --cancel` of it, and no delivered pass of it without the note (an ordinary
 * recovery, 001-398 S2). A retry that fails again is silent, so its FAIL stands. Another claim
 * meets it; `null` without a claim.
 *
 * (c) Where the stopped service is the cause (a9, 006-71): once the service is up and a retry of
 * `file` was queued, the cause is fixed and the right move made, so Squeal's own run of `file`
 * with the service up is as good as the retry's: an edit after the retry re-runs it at new inputs
 * and the retry's own pass never comes (sol's a9 r6 to r8). So a delivered pass of it, or a read
 * as in (b) from `squeal status` or `squeal run --slow`, counts while no FAIL of it was seen
 * since the start and no run since the start could have run it (`ranFile`).
 */
export function claimAfterRetry(tl, claim, { file, inputs = [], cause = null }) {
  if (claim === null || claim === undefined) return null;
  if (claim !== "pass") return true;
  let open = false; // a queued retry, nothing since that could have passed the file otherwise
  let passed = false;
  let seen = -1; // the highest revision seen so far
  let atEdit = -1; // the highest revision seen before the last edit
  let fixed = false; // (c): the service up and a retry queued, no FAIL and no run of it since
  let up = false;
  for (const s of beforeClaim(tl)) {
    if (cause === "service" && started(s)) up = true;
    if (cause === "service" && up && queued(s, file)) fixed = true;
    if (ranFile(s, file)) fixed = false;
    if (queued(s, file)) open = true;
    else if (s.k === "retry" && s.cancel && s.paths.includes(file)) open = false;
    else if (forcedRun(s)) open = false;
    else if (s.k === "edit") {
      atEdit = seen;
      if (inputs.includes(s.path)) [open, passed] = [false, false];
    } else if (s.k === "squeal") {
      const mine = (s.checks ?? []).filter((c) => c.file === file);
      const read = (s.sub === "status" || s.sub === "run") && statusPass(s, file, seen, atEdit);
      if (fixed && (mine.some((c) => c.to === "pass") || read)) passed = true;
      if (mine.some((c) => c.to === "fail")) [passed, up, fixed] = [false, false, false];
      else if (mine.some((c) => c.to === "pass" && c.retried !== undefined)) passed = true;
      else if (s.sub === "run" || mine.some((c) => c.to === "pass")) open = false;
      else if (open && s.sub === "status" && statusPass(s, file, seen, atEdit)) passed = true;
      if (s.revision !== null) seen = Math.max(seen, s.revision);
    }
  }
  return passed;
}

/**
 * A run the agent asked for that could have run `file` (006-71): an own Vitest run of every file
 * or of a filter `file` matches, or a `squeal run` but a `--slow` one, which runs only the slow
 * tier (no retry scenario's `file` is slow). A node:test run never runs a Vitest file.
 */
function ranFile(s, file) {
  if (s.k === "squeal-run") return s.all || !s.slow;
  if (s.k !== "run" || s.informational || s.runner === "node:test") return false;
  const paths = s.scope?.paths ?? [];
  return (
    s.scope?.full || paths.length === 0 || paths.some((p) => file.includes(p.replace(/^\.\//, "")))
  );
}

/**
 * Whether status read `s` says `file` passes now: a daemon validating, at a revision no older
 * than any seen before it and above the last edit's, its fast checks settled, its known
 * failures listed without `file`, and no pending retry of `file`. The slow tier may still run.
 */
function statusPass(s, file, seen, atEdit) {
  const current = s.revision !== null && s.revision >= seen && s.revision > atEdit;
  const settled = s.pending === 0 && s.stale === 0 && s.unknown === 0;
  return (
    s.daemon !== false &&
    current &&
    settled &&
    typeof s.known === "number" &&
    !(s.pendingRetries ?? []).includes(file)
  );
}
