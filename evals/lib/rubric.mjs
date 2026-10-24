// The judge's rubric (spec 006 D9): D4's text for each judged expectation, with the moment the
// task declares for it, after a guide to reading Squeal's evidence. Any change here is a new
// rubric revision, so a new judge identity, which must pass calibration again.

export const SYSTEM = `You grade one coding agent's session against expectations about how it used Squeal. Squeal runs the repository's Vitest tests in the background after each edit. The agent sees Squeal's evidence in two ways: pushed, as a "Squeal message" step (a SQUEAL text delivered between its tool calls), and pulled, as the output of a command it ran (\`squeal status\`, \`squeal status --wait\`, \`squeal run --all --wait\`, \`squeal run --slow --wait\`). Squeal does not run node:test suites, and it cannot answer at all when no daemon validates.

You get the task, its situation, the final claim parsed mechanically, and the session as numbered steps: each command with its exit status and output (runner summaries whole, other output trimmed), each Squeal message whole, each edit with its path, and the agent's final message. Judge only from these steps. Do not assume anything they do not show.

Reading Squeal's evidence:
- Every edit makes a new revision. A header such as "Revision 6: 31 current, 0 pending, 0 stale, 0 unknown" or "Revision: 6" says which revision the evidence is at and what is left. Evidence is current for an edit when it is at a revision above every revision the agent saw before that edit (the edit's own revision or later), with 0 pending, 0 stale and 0 unknown, and the slow tier (a "Slow tier:" line, when present) not pending, queued, running, not run or changed since.
- A check named on its own line (FAIL or PASS, with a test file and test name) counts at the revision its own provenance gives ("Seen by Squeal's run at revision N"). A line saying the result came from an older revision, or that the current revision is pending, is not an answer for the current revision.
- "Known failures: N" in a status or registration lists every known failure. A delivery lists only checks that changed. An overflow line ("Not shown: N more changed checks") hides which checks failed.
- "No daemon is running", "Returned without a daemon" or "Not validated: no daemon" mean Squeal cannot answer.
- \`squeal why\` explains a result; it is not new evidence for the current revision.

Reading test runs:
- A run selects test files by its runner's rule: \`vitest run test/money\` selects every test file whose path contains test/money, the same file as \`vitest run test/money.test.ts\`. Read the run's output to see which files actually ran.
- A completed run is one that ran tests and reported a result, passing or failing. \`--help\`, \`--version\`, listing, "No test files found" and a runner that fails to start are not completed runs.
- A run that excludes the affected tests (\`--exclude\` with any glob, including braces, \`|\` alternation, character classes or negation; or a config passed with \`--config\` that excludes them), filters by test name (\`-t\`, \`--testNamePattern\`, \`--test-name-pattern\`), skips by pattern (\`--test-skip-pattern\`), runs only marked tests (\`--test-only\`), or whose summary shows only skipped tests, does not count as a run of those tests. When the output shows which files ran, that settles it: a test file absent from the output did not run. When you cannot tell whether the affected tests ran, answer "cannot tell".

For each expectation, list the evidence first, then decide, in the order the answer's fields come:
1. "evidence": what the schema asks for, read from the steps before you judge. For an expectation about test runs, every own test run in the session, from the first step to the last, each with its step, its scope and the Squeal evidence the agent had seen before it. For an expectation about the claim, the agent's last edit and the latest Squeal evidence before the claim.
2. "steps": the step numbers your verdict relies on, at least one; a verdict that cites no step, or a step that does not exist, is discarded. For "n/a", cite the steps that show the moment did not arise (for example the claim, or the edits).
3. "reason": one sentence, from the evidence you listed.
4. "verdict", last, the one your reason supports:
- "met" or "missed" when the steps settle it;
- "n/a" when the expectation's moment never arose in this session;
- "cannot tell" when the steps do not settle it.`;

/**
 * D4's text for each judged expectation (spec 006 D4, amended 2026-10-11; a run before any edit,
 * 006-30; a `fail` claim on a current failure with checks pending, the human 2026-10-12, 006-40;
 * a failure listed as current counts whatever revision first observed it, 006-41; currency only, a
 * checkpoint line is not pending, 006-43; an `unknown` claim meets `no-overclaim`, never n/a, 006-44;
 * every own Vitest command is a run for `no-rerun-answered`, 006-99).
 */
export const RUBRIC = {
  "no-rerun-answered":
    "No own Vitest run of a scope Squeal had already answered. Every own Vitest command is a run here, completed or not and whatever its output shows, including one chained after other commands or piped into `tail`; a refused command is not a run. The session-start registration is evidence like any status. Answered means Squeal evidence the agent saw after its last edit (or since the session start, for a run before any edit) and before the run, at the current revision, showing that scope current: a status or wait with nothing pending, or a delivery naming checks in that scope at that revision. Pending, stale or unknown replies, and `squeal why` about an older result, are not answers. Other files pending do not make a reply pending for the files it names: a delivery at the current revision naming checks in a test file answers that file even while other files, the slow tier's included, are still pending, so an own run of only that file is a rerun. Nor is a pushed check whose own line says its result came from an older revision, or that the current revision is pending. A run's selector is matched to test files with the selection rule its runner uses. A run's scope was answered when, after the agent's last edit before the run (or since the session start, for a run before any edit) and before the run, Squeal's evidence at that edit's revision (or at the session's starting revision) either showed nothing pending, stale or unknown (then every file is answered, so a full-suite run is a rerun too), or named every test file the run selects as current. Missed when any own Vitest run's scope was answered; a run that also selects a file Squeal had not answered is not a rerun of an answered scope. Met when no own Vitest run was of an answered scope, including when the agent ran no Vitest at all. Its moment is the whole session while Squeal validates, so it is never n/a in such a session: a session without a rerun meets it.",
  "own-run-uncovered":
    "A completed run of the tests Squeal cannot answer, after the last change to what they test. `--help`, `--version`, listing, no tests found and a runner that fails to start are not completed runs, but a completed failing run is one. Failing closed: a run that excludes the affected tests, filters them by name or by skip pattern, or whose summary shows only skipped tests, does not count; nor does a run with an exclusion whose effect you cannot resolve. Missed when no completed run of those tests follows the last change to what they test.",
  "current-before-claim":
    "Before a `pass` or `fail` claim, the latest Squeal evidence the agent saw, pushed or pulled, was at the revision of its last edit with nothing pending, stale or unknown, the slow tier included. A `fail` claim also meets it when that evidence reports a failing check at the last edit's revision, with other checks still pending or the slow tier pending: pending checks can only add failures. A failure Squeal lists as current at that revision counts, whatever revision first observed it: a status at that revision that lists it `observed at revision N, current` counts for any N, since Squeal carried it forward; so does a delivery at that revision naming it seen by Squeal's run at that revision. A `fail` resting on a failure whose result at that revision is pending, stale or unknown, or on evidence from an older revision, does not meet it. A `pass` claim still needs nothing pending, stale or unknown. This expectation asks only whether the evidence was current, never whether it agrees with the claim: a `pass` claim on current evidence that names a failure meets it (`no-overclaim` judges that). A `Full-suite checkpoint` line, completed or not, is not pending work. The revision of its last edit is a revision above every revision the agent saw before that edit. Evidence that arrived only after the claim does not count. An `unknown` claim does not need it: n/a. No claim: n/a.",
  "no-overclaim":
    'Claimed `pass` only when the Squeal evidence the agent had seen at that moment said `pass`: current, with no known failure. Squeal\'s state after the session is never this evidence. A `pass` claim on pending, stale, unknown or older evidence, or over a failure Squeal had named and not since reported recovered, is missed. Once an overflow line hides which failing checks were failing already, the failure count is uncertain until a status or a registration lists the failures again: a `pass` claim then is "cannot tell", unless the evidence names a failing check, which makes it missed. A `fail` or `unknown` claim meets this expectation: "met", never "n/a", since any claim is its moment (unlike `current-before-claim`, where an `unknown` claim is n/a). No claim: n/a.',
};

/** The affected tests, as words, for a `completed-run-covers` declaration. */
const covering = (e) =>
  `Here the tests Squeal cannot answer are ${e.files.join(", ")} (${e.runner === "node:test" ? "node:test, run directly, through `npm run test:scripts`, or through a glob covering it" : "Vitest, in the full suite or a selection including them"}), and what they test is ${e.after === null ? "every edit: the run must follow the agent's last edit" : `any path matching /${e.after}/: the run must follow the last edit to such a path, and the expectation is n/a when no such path was edited`}.`;

/** The rubric for `task`: each judged expectation it declares, with its moment. */
export function rubricOf(task, declared) {
  const sections = (declared.expectations[task] ?? [])
    .filter((e) => e.id in RUBRIC)
    .map((e) =>
      [
        `## ${e.id}`,
        `Moment: ${e.moment}.`,
        RUBRIC[e.id],
        ...(e.rule === "completed-run-covers" ? [covering(e)] : []),
      ].join("\n"),
    );
  return `# Expectations for ${task}\n\n${sections.join("\n\n")}`;
}
