// The `checks` knob (row 005-127, a12-manual-check): check groups (spec 019 D1) committed into the
// fixture's squeal.config.json before the warm-up, so the warm-up runs and stores them as a
// repository with that config would have them. Every other fixture keeps its config.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Knob `knobs.checks` (a list of check groups) into the fixture at `work`'s config, committed
 * (`git` runs git there) so the session's `git status` stays clean.
 */
export function addChecks(knobs, { work, git, log }) {
  if (!knobs.checks) return;
  const file = join(work, "squeal.config.json");
  const policy = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, `${JSON.stringify({ ...policy, checks: knobs.checks }, null, 2)}\n`);
  git(["commit", "-q", "-m", "Name the test checks", "--", file]);
  log(`checks: ${knobs.checks.map((c) => `${c.name} at ${c.at}`).join(", ")}`);
}

/**
 * Whether `squeal status` output `text` names a config problem (its `Config problem:` line). The
 * fixture's own config has none, so with the knob one is the knob's.
 */
export function checksProblem(text) {
  return /^Config problems?:/m.test(String(text));
}

/**
 * Throws when `squeal status` output `text` names a config problem: the pinned CLI left a check
 * group of the knob out (a CLI without 005-126's `description`, or a regression in the
 * candidate's validation), and the cell would measure another situation. The cell's setup fails,
 * so the run lists it as failed and the comparison counts it missing (review
 * exp-minimal-primer-design B2).
 */
export function assertChecksAccepted(text) {
  if (!checksProblem(text)) return;
  const line = /^Config problems?:.*$/m.exec(String(text))?.[0];
  throw new Error(`the pinned CLI does not accept the checks knob's config: ${line}`);
}
