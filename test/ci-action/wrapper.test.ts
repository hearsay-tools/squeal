import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Checkout, checkout, scratch, step } from "./checkout.js";

/*
 * Spec 018 D20.2, row 018-33 item 1: the `squeal` the action puts on the
 * PATH runs the checkout's bundled CLI with the node on the PATH. When
 * Squeal cannot run, it passes through and never fails the step:
 * `squeal ci record -- <command>` runs the command and exits with its code,
 * `export` and `publish` exit 0, each with a warning in the job log and the
 * step summary.
 */

const squeal = (at: Checkout, args: readonly string[], env?: Record<string, string>) =>
  step(at, join(at.action, "bin/squeal"), args, env);

const exit3 = ["/bin/sh", "-c", "echo ran; exit 3"];

/** The workflow command a pass-through prints, for `problem` and `then`. */
const warning = (problem: string, then: string) =>
  `::warning title=Squeal::Squeal cannot run here: ${problem}. ${then}\n`;

const RECORD_THEN = "The command runs without recording, so this step shares no results.";

describe("the action's squeal command", () => {
  it("runs the bundled CLI with its arguments, and keeps the CLI's exit code", () => {
    const at = checkout();
    const record = squeal(at, ["ci", "record", "--out", "parts", "--", ...exit3]);
    expect(record).toMatchObject({ code: 3, stdout: "ran\n", summary: "" });
    expect(record.calls).toEqual([["ci", "record", "--out", "parts", "--", ...exit3]]);
    expect(squeal(at, ["ci", "export", "--parts", "p"]).code).toBe(0);
    // A refusal of Squeal's own in the export job keeps its code: that job gates no merge.
    const refused = squeal(at, ["ci", "publish", "r.json.gz"], { STUB_EXIT: "1" });
    expect(refused).toMatchObject({ code: 1, stdout: "", summary: "" });
    expect(refused.calls).toEqual([["ci", "publish", "r.json.gz"]]);
  });

  it("passes through when node on the PATH is older than Squeal's floor", () => {
    const at = checkout({ floor: "999.0" });
    const problem = `Squeal needs Node 999.0 or later, and node is ${process.versions.node}`;
    const record = squeal(at, ["ci", "record", "--out", "parts", "--", ...exit3]);
    expect(record).toMatchObject({
      code: 3,
      stdout: `${warning(problem, RECORD_THEN)}ran\n`,
      calls: [],
    });
    expect(record.summary).toBe(
      `**Squeal:** Squeal cannot run here: ${problem}. ${RECORD_THEN}\n\n`,
    );
    for (const sub of ["export", "publish"]) {
      const run = squeal(at, ["ci", sub, "x"]);
      expect(run).toMatchObject({
        code: 0,
        stdout: warning(problem, `squeal ci ${sub} did nothing.`),
        calls: [],
      });
      expect(run.summary).toContain(`squeal ci ${sub} did nothing.`);
    }
    // Not a command the action provides: Squeal did not run, and says so.
    expect(squeal(at, ["--version"])).toMatchObject({
      code: 1,
      stdout: warning(problem, "squeal --version did not run."),
    });
  });

  it("passes through when node is not on the PATH", () => {
    const at = checkout();
    const record = squeal(at, ["ci", "record", "--", ...exit3], { PATH: scratch("empty") });
    expect(record).toMatchObject({
      code: 3,
      stdout: `${warning("node is not on the PATH", RECORD_THEN)}ran\n`,
    });
  });

  it("passes through when the checkout has no bundled CLI", () => {
    const at = checkout({ cli: null });
    const record = squeal(at, ["ci", "record", "--", ...exit3]);
    const problem = "this checkout of Squeal has no plugins/claude-code/dist/cli/squeal.mjs";
    expect(record).toMatchObject({ code: 3, stdout: `${warning(problem, RECORD_THEN)}ran\n` });
  });

  it("passes through after a setup that found the CLI broken, escaping % only in the log", () => {
    const at = checkout();
    const env = { SQUEAL_CI_SETUP_FAILED: "the CLI is 50% broken" };
    const record = squeal(at, ["ci", "record", "--", ...exit3], env);
    expect(record).toMatchObject({
      code: 3,
      stdout: `${warning("the CLI is 50%25 broken", RECORD_THEN)}ran\n`,
      calls: [],
    });
    expect(record.summary).toContain("the CLI is 50% broken.");
  });

  it("passing through, exits as the CLI would: no command, a command not found", () => {
    const at = checkout({ floor: "999.0" });
    const none = squeal(at, ["ci", "record", "--out", "parts"]);
    expect(none.code).toBe(2);
    expect(none.stderr).toContain("usage: squeal ci record [--out <dir>] -- <command> [args...]");
    expect(squeal(at, ["ci", "record", "--"]).code).toBe(2);
    const missing = squeal(at, ["ci", "record", "--", "/no/such/program"]);
    expect(missing.code).toBe(127);
  });
});
