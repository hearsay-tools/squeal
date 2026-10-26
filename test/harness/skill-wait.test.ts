import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_DIR } from "../../src/harness/claude-code/build.js";
import { CODEX_PLUGIN_DIR, CODEX_SKILL } from "../../src/harness/codex/build.js";
import { PI_PLUGIN_DIR, PI_SKILL } from "../../src/harness/pi/build.js";

/*
 * Spec 005 D6 as amended by the human (2026-10-17, task 005-68, issue 18):
 * the skill says which wait applies when, as the primer does, and what a
 * path selects since 005-67: a listed test file only itself, any other
 * path every test file that reads it.
 */

const COPIES = [
  join(PLUGIN_DIR, "skills/squeal"),
  join(CODEX_PLUGIN_DIR, CODEX_SKILL),
  join(PI_PLUGIN_DIR, PI_SKILL),
];
const read = (dir: string, name: string) => readFileSync(join(dir, name), "utf8");
const step3 = (text: string) => text.slice(text.indexOf("3. **"), text.indexOf("4. **"));
const [claude] = COPIES as [string];

describe("the skill's waits (005-68)", () => {
  it("names the path wait for files just changed, then the waits before done, in step 3", () => {
    const step = step3(read(claude, "SKILL.md"));
    expect(step).toContain(
      "For files you just changed, `squeal status --wait 60000 <path>...` gives the verdict of the test files they select.",
    );
    expect(step).toContain("Before saying the task is done, run `squeal status --wait 60000`");
    expect(step).toContain("`squeal run --all --wait` is a full-suite checkpoint");
    expect(step.indexOf("next tool call")).toBeLessThan(step.indexOf("status --wait"));
  });

  it("says the same step 3 in every copy", () => {
    for (const dir of COPIES.slice(1)) {
      expect(step3(read(dir, "SKILL.md"))).toBe(step3(read(claude, "SKILL.md")));
    }
  });

  it("says in `commands.md` when to name paths and what each path selects", () => {
    const commands = read(claude, "references/commands.md");
    expect(commands).toContain(
      "Name the files you just changed when the wait above would hold for many more (after an edit to an environment input, or other edits that re-keyed most of the suite), or a test file your edits did not re-key, which the wait above does not hold for.",
    );
    expect(commands).toContain(
      "A test file's path selects only that test file, even when other test files import it or read it; any other path, such as a source file, selects every test file that imports or reads it",
    );
    expect(commands).not.toContain("A test file's path selects that test file, and");
  });

  /*
   * Task 004-78, at the coordinator's request: a named wait leaves out slow
   * files that run only on a pause; since 004-80 only under `slow.trigger:
   * "idle"`, as by default they run after the fast tests and it holds for them.
   */
  it("says in every copy of `commands.md` that a named wait does not hold for a slow file waiting for a pause", () => {
    for (const dir of COPIES) {
      expect(read(dir, "references/commands.md")).toContain(
        'A selected slow file is held for like any file, since it runs after the fast tests; under `slow.trigger: "idle"` one that waits for a pause or `squeal run --slow` is not held for: the verdict line names it, and a wait that selects only such files returns at once without a verdict (exit 3).',
      );
    }
  });

  /* Row 011-28 (005 D2 as amended 2026-10-20, gh-42, gh-44): the short named text and the snapshot. */
  it("says in every copy of `commands.md` what a named wait prints and what `status <path>...` answers", () => {
    for (const dir of COPIES) {
      const commands = read(dir, "references/commands.md");
      expect(commands).toContain(
        "It prints the revision line, then the files it selected and their failures in full",
      );
      expect(commands).toContain("`--full` prints the worktree's status first.");
      expect(commands).toContain(
        "`squeal status <path>...` without `--wait` answers the same question now, without waiting for pending files, whose results arrive with your next tool call.",
      );
      expect(commands).toContain(
        "the line says `the daemon has not stored its pass over the latest edits` and gives no verdict",
      );
      // Row 011-243 (gh-99): what a line with no verdict says, and the one rule after it.
      expect(commands).toContain(
        "Without a verdict, the line says which revision the passes it lists ran at, that a later pass is not reported and a failure arrives with a later tool call, and ends with the command to wait again. After exit 3, run the same wait again before you report a result.",
      );
      expect(commands).not.toContain("It prints status, then the files it selected");
    }
  });

  /*
   * Row 011-63 (gh-59, gh-65, gh-51): a path that selects nothing beside one
   * that selects a file, the selection's one JSON path, and the promotion at
   * a wait's deadline.
   */
  it("says in every copy of `commands.md` how a mixed selection exits and where both forms put the selection", () => {
    for (const dir of COPIES) {
      const commands = read(dir, "references/commands.md");
      expect(commands).toContain(
        "the wait still holds for the files the other paths select, and exits 1 with a known failure among them, else 3.",
      );
      expect(commands).toContain(
        "With `--json`, stdout is the snapshot with a `selection` field, and the lines go to stderr",
      );
      expect(commands).toContain("so one filter on `selection.testFiles` reads both forms");
      expect(commands).toContain("says `queued, promoted`, also when the wait times out.");
      expect(commands).not.toContain("A path that selects nothing exits 3 with");
    }
  });

  /*
   * Row 011-206 (gh-84, gh-83, gh-88): the selection's word and reason to
   * gate on, never a file's `state`, and a named test file Squeal does not run.
   */
  it("says in every copy of `commands.md` to gate on `selection.code` or `selection.result`, with the reasons", () => {
    for (const dir of COPIES) {
      const commands = read(dir, "references/commands.md");
      expect(commands).toContain(
        "Gate on `selection.code` or `selection.result`, never on a file's `state`: `current` says a result is up to date, not that it passes.",
      );
      expect(commands).toContain(
        "`no-daemon`, `lapsed`, `on-hold`, `paused`, `focused`, `unsynced`, `unlisted`, `pending`, `not-current`, `not-run` or `unmatched`",
      );
      expect(commands).toContain(
        "Squeal does not run it, the test files that read it are not it, and with them passing the selection has no verdict (exit 3)",
      );
    }
  });

  /* Task 004-66, at the coordinator's request: `run --slow --wait` without a verdict exits 3. */
  it("gives `run --slow --wait`'s exit 3 in `commands.md`", () => {
    expect(read(claude, "references/commands.md")).toContain(
      "With `--wait`, exit 3 means it has no verdict: the wait returned without a daemon, or timed out with a slow file it queued still pending; say so, or wait again.",
    );
  });
});
