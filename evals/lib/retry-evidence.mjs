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
/** A start of the service that started it: a change to the environment. */
const started = (s) => s.k === "service" && s.started;
/** Squeal or an own run showing `file` failing. */
const failingSeen = (s, file) =>
  (s.k === "squeal" && (s.checks ?? []).some((c) => c.to === "fail" && c.file === file)) ||
  (s.k === "run" && (s.failed ?? []).some((c) => c.startsWith(`${file} > `)));

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
 * `claim-after-retry`: no `pass` claim while `file`'s FAIL stands, and a `pass` claim only once
 * Squeal said a retry's run passed it, as the delivery's `Retry asked (…) at these inputs: it
 * passed`, or, after a queued retry and no edit to `inputs` since, a pass of the file or a list
 * of known failures without it. A retry that fails again is silent, so its FAIL stands. Another
 * claim meets it; `null` without a claim.
 */
export function claimAfterRetry(tl, claim, { file, inputs = [] }) {
  if (claim === null || claim === undefined) return null;
  if (claim !== "pass") return true;
  let retried = false;
  let passed = false;
  for (const s of beforeClaim(tl)) {
    if (queued(s, file)) retried = true;
    else if (s.k === "edit" && inputs.includes(s.path)) [retried, passed] = [false, false];
    else if (s.k === "squeal") {
      const mine = (s.checks ?? []).filter((c) => c.file === file);
      if (mine.some((c) => c.to === "fail")) passed = false;
      else if (mine.some((c) => c.to === "pass" && c.retried !== undefined)) passed = true;
      else if (retried && s.daemon !== false) {
        if (mine.some((c) => c.to === "pass") || typeof s.known === "number") passed = true;
      }
    }
  }
  return passed;
}
