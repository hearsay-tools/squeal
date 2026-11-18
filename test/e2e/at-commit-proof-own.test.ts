import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../src/harness/build.js";
import {
  assertionOf,
  type Bench,
  bench,
  checkoutAt,
  clone,
  git,
  proof,
  sweep,
  timed,
} from "./at-commit-kit.js";

/*
 * Spec 023 Testing, end to end, on a copy of this repository: a red proof of a
 * real fix (20f03a431), and the synthetic `--without` HOME case with
 * `--home-keep` (the coordinator's choice B, 2026-11-18: squawk's test setups
 * give every covered test a sandbox HOME, so no squawk fix hides a HOME file).
 */

const CASE_MS = 600_000;
const b: Bench = bench();
afterAll(() => sweep(b));
let copy: string | undefined;
const own = (): string => (copy ??= clone(b, REPO_ROOT, "squeal"));

/** A synthetic test that reads its retry count from a HOME file it never wrote; it needs a second HOME file too. */
const OLD_TEST = `import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

// Synthetic fixture of row 023-09: a hidden dependency on a HOME file the test never wrote.
const tool = join(homedir(), ".proof-e2e");
const profile = () => JSON.parse(readFileSync(join(tool, "profile.json"), "utf8")) as { name: string };
const defaults = (): { retries?: number } => {
  try {
    return JSON.parse(readFileSync(join(tool, "defaults.json"), "utf8"));
  } catch {
    return {};
  }
};
const retries = (options: { retries?: number }) => options.retries ?? 1;

it("retries three times for the e2e profile", () => {
  expect(profile().name).toBe("e2e");
  expect(retries(defaults())).toBe(3);
});
`;
const FIXED_TEST = OLD_TEST.replace(
  "expect(retries(defaults())).toBe(3);",
  "expect(retries({ ...defaults(), retries: 3 })).toBe(3);",
);
const SYNTHETIC = "test/proof-e2e/home-defaults.test.ts";

describe("squeal proof on a copy of this repository", () => {
  it(
    "source: 20f03a431 is proven with the red side's assertion; base HEAD is not red",
    async () => {
      await timed("proof source, squeal 20f03a431", () => {
        const dir = own();
        checkoutAt(b, dir, "20f03a43139ea3e99e057b32dac3db3dffbb903d");
        const test = "test/store/open.test.ts";

        const proven = proof(b, dir, [test, "--base", "HEAD~1"]);
        expect(proven.code, proven.text).toBe(0);
        expect(proven.report.case).toBe("source");
        expect(proven.file).toMatchObject({
          verdict: "proven",
          red: { end: "fail" },
          green: { end: "pass" },
        });
        const name =
          "a mark that a read or write left (row 011-391) > keeps a parsed mark's unknown finder, never the full check's (review 0.1.559 S1)";
        expect(assertionOf(proven.file, name)).toContain('-   "found": "unknown",');

        const control = proof(b, dir, [test, "--base", "HEAD", "--case", "source"]);
        expect(control.code, control.text).toBe(1);
        expect(control.file.verdict).toBe("not red");
      });
    },
    CASE_MS,
  );

  it(
    "synthetic dependency --without a HOME file and --home-keep: proven only under the condition, with the kept file",
    async () => {
      await timed("proof dependency --without --home-keep, synthetic", () => {
        const dir = own();
        checkoutAt(b, dir, "20f03a43139ea3e99e057b32dac3db3dffbb903d");
        const tool = join(b.home, ".proof-e2e");
        mkdirSync(tool, { recursive: true });
        const hidden = join(tool, "defaults.json");
        const kept = join(tool, "profile.json");
        writeFileSync(hidden, JSON.stringify({ retries: 3 }));
        writeFileSync(kept, JSON.stringify({ name: "e2e" }));
        mkdirSync(dirname(join(dir, SYNTHETIC)), { recursive: true });
        writeFileSync(join(dir, SYNTHETIC), OLD_TEST);
        git(b, dir, ["add", SYNTHETIC]);
        git(b, dir, [
          "commit",
          "-qm",
          "test: synthetic base that reads ~/.proof-e2e/defaults.json",
        ]);
        writeFileSync(join(dir, SYNTHETIC), FIXED_TEST);
        git(b, dir, ["commit", "-qam", "test: synthetic fix that sets its own retries"]);

        const condition = ["--case", "dependency", "--without", hidden];
        const proven = proof(b, dir, [
          SYNTHETIC,
          "--base",
          "HEAD~1",
          ...condition,
          "--home-keep",
          kept,
        ]);
        expect(proven.code, proven.text).toBe(0);
        expect(proven.file).toMatchObject({
          verdict: "proven",
          red: { end: "fail" },
          green: { end: "pass" },
        });
        expect(assertionOf(proven.file, "retries three times for the e2e profile")).toContain(
          "expected 1 to be 3",
        );

        // With the HOME file present the old test passes: no condition, no proof.
        const bare = proof(b, dir, [SYNTHETIC, "--base", "HEAD~1", "--case", "test"]);
        expect(bare.code, bare.text).toBe(1);
        expect(bare.file.verdict).toBe("not red");

        // Without --home-keep the run's own HOME is empty: the profile read throws on both sides.
        const unkept = proof(b, dir, [SYNTHETIC, "--base", "HEAD~1", ...condition]);
        expect(unkept.code, unkept.text).toBe(3);
        expect(unkept.file.verdict).toBe("red for another reason");

        // The command's own HOME files are untouched.
        expect(existsSync(hidden)).toBe(true);
        expect(readFileSync(kept, "utf8")).toBe(JSON.stringify({ name: "e2e" }));
      });
    },
    CASE_MS,
  );
});
