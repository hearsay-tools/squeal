import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  AT_E2E,
  assertionOf,
  type Bench,
  bench,
  checkoutAt,
  clone,
  git,
  proof,
  SQUAWK,
  SQUAWK_PRESENT,
  SQUAWK_SKIP,
  sweep,
  timed,
} from "./at-commit-kit.js";

/*
 * Spec 023 Testing, end to end: one `squeal proof` per case (D5) on real
 * squawk fixes, each with a control that must not read `proven`. Why each
 * commit fits is in `docs/specifications/023-results-at-commit/tasks/023-09-notes.md`.
 */

const CASE_MS = 600_000;
const skip = !SQUAWK_PRESENT;
// Made only when the suite runs (SQUEAL_E2E_AT=1): a skipped file makes no folder.
const b: Bench = AT_E2E ? bench() : ({} as Bench);
afterAll(() => {
  if (AT_E2E) sweep(b);
});

let copy: string | undefined;
/** One copy of squawk for the three cases; each moves it to its own commit. */
const squawkAt = (commit: string): string => {
  copy ??= clone(b, SQUAWK, "squawk");
  checkoutAt(b, copy, commit);
  return copy;
};

describe.skipIf(!AT_E2E)("squeal proof on squawk fixes", () => {
  it.skipIf(skip)(
    skip
      ? SQUAWK_SKIP
      : "source: 6414b6c20 is proven with the red side's assertion; base HEAD is not red",
    async () => {
      await timed("proof source, squawk 6414b6c20", () => {
        const dir = squawkAt("6414b6c2077f7d600b2b50cbdbec502ca654d066");
        const test = ".github/scripts/queue-ci-proof.test.cjs";

        const first = proof(b, dir, [test, "--base", "HEAD~1"]);
        expect(first.code, first.text).toBe(0);
        expect(first.report.case).toBe("source");
        expect(first.file).toMatchObject({
          verdict: "proven",
          red: { end: "fail" },
          green: { end: "pass" },
        });
        const text = assertionOf(
          first.file,
          "a running queue run whose gate passed is proof while jobs outside the gate still run",
        );
        expect(text).toContain("false !== true");
        expect(first.file.red.failures.every((f) => f.kind === "assertion")).toBe(true);

        // Both sides were stored at their keys: the second call runs nothing.
        const again = proof(b, dir, [test, "--base", "HEAD~1"]);
        expect(again.code, again.text).toBe(0);
        expect(again.report.runs).toBe(0);
        expect(again.file).toMatchObject({
          verdict: "proven",
          red: { from: "store" },
          green: { from: "store" },
        });

        const control = proof(b, dir, [test, "--base", "HEAD", "--case", "source"]);
        expect(control.code, control.text).toBe(1);
        expect(control.file.verdict).toBe("not red");
      });
    },
    CASE_MS,
  );

  it.skipIf(skip)(
    skip
      ? SQUAWK_SKIP
      : "test --repeat 3: e71888f91's old test fails at its first run, the fixed one passes three; base HEAD is not red",
    async () => {
      await timed("proof test --repeat 3, squawk e71888f91", () => {
        const dir = squawkAt("e71888f91");
        const test = "packages/cezar/src/automations/unhandled-polls.test.ts";

        const proven = proof(b, dir, [test, "--base", "HEAD~1", "--case", "test", "--repeat", "3"]);
        expect(proven.code, proven.text).toBe(0);
        expect(proven.report.repeat).toBe(3);
        expect(proven.file).toMatchObject({
          verdict: "proven",
          red: { end: "fail", runs: 1 },
          green: { end: "pass", runs: 3 },
        });
        const text = assertionOf(
          proven.file,
          "counts only unhandled matching issues and resumes after restart (history=true)",
        );
        expect(text).toContain("expected [] to deeply equal [ 101, 102, 103, 104, 105 ]");

        // The fixed test as its own base: red runs three times and passes each time.
        const control = proof(b, dir, [test, "--base", "HEAD", "--case", "test", "--repeat", "3"]);
        expect(control.code, control.text).toBe(1);
        expect(control.file).toMatchObject({ verdict: "not red", red: { end: "pass", runs: 3 } });
      });
    },
    CASE_MS,
  );

  it.skipIf(skip)(
    skip
      ? SQUAWK_SKIP
      : "dependency --env: feb856667's inherited GITHUB_RUN_ATTEMPT, as a fixture on 0dfe0724c, is proven only under the variable",
    async () => {
      await timed("proof dependency --env, squawk fixture of feb856667", () => {
        const dir = squawkAt("0dfe0724c");
        const test = "scripts/release-identity.test.mjs";
        const fixed = readFileSync(join(dir, test), "utf8");
        // feb856667's defect: the run's environment neutralised GITHUB_ACTIONS but let the
        // workflow's own GITHUB_RUN_ATTEMPT through. Both edits must apply.
        const old = fixed
          .replace("GITHUB_|ACTIONS_ID_TOKEN_", "GITHUB_ACTIONS$|ACTIONS_ID_TOKEN_")
          .replace("GITHUB_RUN_ATTEMPT: '1', ", "");
        expect(old).toContain("GITHUB_ACTIONS$|ACTIONS_ID_TOKEN_");
        expect(old).not.toContain("GITHUB_RUN_ATTEMPT: '1', ");
        writeFileSync(join(dir, test), old);
        git(b, dir, [
          "commit",
          "-qam",
          "test(release): fixture base, the run inherits GITHUB_RUN_ATTEMPT",
        ]);
        writeFileSync(join(dir, test), fixed);
        git(b, dir, [
          "commit",
          "-qam",
          "test(release): fixture fix, pin GITHUB_RUN_ATTEMPT (feb856667)",
        ]);

        const proven = proof(b, dir, [
          test,
          "--base",
          "HEAD~1",
          "--case",
          "dependency",
          "--env",
          "GITHUB_RUN_ATTEMPT=2",
        ]);
        expect(proven.code, proven.text).toBe(0);
        expect(proven.file).toMatchObject({
          verdict: "proven",
          red: { end: "fail" },
          green: { end: "pass" },
        });
        const text = assertionOf(
          proven.file,
          "dev release publishes the new package and the compatibility packages",
        );
        expect(text).toContain("'1.2.3-dev.9.2'");

        // Row 023-20 (P9): the command's own control run, the red side once without the
        // variable, passes: the dependency is hidden, not a defect of the code.
        expect(proven.file).toMatchObject({
          reason: null,
          controlReading: "red only under the conditions",
          control: { end: "pass" },
        });
      });
    },
    CASE_MS,
  );
});
