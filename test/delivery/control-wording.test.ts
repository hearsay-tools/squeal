import { expect, it } from "vitest";
import { primer } from "../../src/harness/shared/primer.js";
import { wordingPass } from "../e2e/control-wording.js";

// Row 005-94: the 0.1.393 control's texts as the wording pass gives them (the `accepted` list of
// `test/e2e/run-triggers-control.test.ts`), so the e2e comparison reads the human's texts.

it("maps 0.1.393's registration, Stop, owed counts and unlisted forms, and leaves status alone", () => {
  const reg = [
    "SQUEAL · registered at revision 3",
    "Revision 3 · <sha> + 0, dirty (changed src/a.ts): 31 current (24 tests, 7 test files loaded), 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: none completed at any revision (the counts are for revision 3; `squeal run --all` requests one).",
    "Known failures: 0; all 7 test files current",
    "Complexity: counting has not started.",
    "Lint: 1 file with findings; squeal lint lists them.",
  ].join("\n");
  expect(wordingPass(reg, 7)).toBe(
    [
      "SQUEAL · registered at revision 3",
      "Revision 3 (changed src/a.ts).",
      "Known failures: 0; all 7 test files are current (run on the files as they are now).",
      "Lint: 1 file with findings; squeal lint lists them.",
    ].join("\n"),
  );
  const stop =
    "SQUEAL · status at revision 4\nRevision 4 · <sha> + 1: 31 current, 0 pending, 0 stale, 0 unknown. Full-suite checkpoint: completed at revision 4.\nKnown failures: 2 (a > b, c > d); not current: 1 of 7 test files (1 queued), 1 test (1 queued)";
  expect(wordingPass(stop, 7)).toBe(
    "SQUEAL · status at revision 4\nKnown failures: 2 (a > b, c > d); 6 of 7 test files are current (run on the files as they are now), and `squeal status` counts the rest.",
  );
  const owed =
    "SQUEAL · first results in this worktree at revision 2\nRevision 2 · <sha> + 0: 31 current, 0 pending, 0 stale, 0 unknown. Inherited: 3 of 31 current.";
  expect(wordingPass(owed, 7)).toBe(
    "SQUEAL · first results in this worktree at revision 2\nRevision 2: all 7 test files are current (run on the files as they are now).",
  );
  const unl =
    "SQUEAL · registered at revision 0\nRevision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change. A daemon is starting; results are as of revision 0.";
  expect(wordingPass(unl, 7)).toBe(
    "SQUEAL · registered at revision 0\nRevision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change.",
  );
  expect(
    wordingPass("Revision: 3 · <sha> + 0\nKnown failures: 0; all 7 test files current", 7),
  ).toBe("Revision: 3 · <sha> + 0\nKnown failures: 0; all 7 test files current");
});

// Row 005-128: the long start message after a registration, or alone after `compact`, is the
// short one, naming the CLI the control's text named.
it("maps 0.1.393's start message to the short one, naming the same CLI", () => {
  const old = (cli: string) =>
    `Squeal runs this repository's Vitest tests in the background after each edit; do not run Vitest to learn whether your edits broke something. Wait only when you need a result: \`${cli} status --wait 60000\` before you finish. Squeal does not cover typecheck, build or any other test suite: run those yourself.`;
  const head = "SQUEAL · registered at revision 0\nRevision 0.";
  expect(wordingPass(`${head}\n\n${old("squeal")}`, 7)).toBe(`${head}\n\n${primer()}`);
  expect(wordingPass(old("squeal"), 7)).toBe(primer());
  const codex = "node --disable-warning=ExperimentalWarning '/p/dist/cli/squeal.mjs'";
  expect(wordingPass(`${head}\n\n${old(codex)}`, 7)).toBe(`${head}\n\n${primer(codex)}`);
});
