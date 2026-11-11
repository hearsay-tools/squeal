import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Checkout, checkout, scratch, step } from "./checkout.js";

/*
 * Spec 018 D20.2, row 018-33 item 1: the `squeal` the action puts on the
 * PATH runs the checkout's bundled CLI with the node on the PATH. When
 * Squeal cannot run, it passes through and never fails the step:
 * `squeal ci record -- <command>` runs the command and exits with its code,
 * `export` and `publish` exit 0, each with a warning in the job log and the
 * step summary. When Squeal runs, a refusal or a crash of `export` or
 * `publish` warns the same way and exits 0; a usage error still fails
 * (the coordinator for the human, 2026-11-11).
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
    const published = squeal(at, ["ci", "publish", "r.json.gz"], {
      STUB_OUT: "Published refs/squeal/abc.\n",
      STUB_ERR: "a note\n",
    });
    expect(published).toMatchObject({
      code: 0,
      stdout: "Published refs/squeal/abc.\n",
      stderr: "a note\n",
      summary: "",
    });
    expect(published.calls).toEqual([["ci", "publish", "r.json.gz"]]);
  });

  it("turns a refusal or a crash of export or publish into a warning and exits 0", () => {
    const at = checkout();
    const temp = scratch("runner-temp");
    const shared = (sub: string, env: Record<string, string>) =>
      squeal(at, ["ci", sub, "x"], { RUNNER_TEMP: temp, ...env });
    const failed = (sub: string, exit: number, error: string) =>
      `squeal ci ${sub} failed (exit ${exit}): ${error}. The run's result stays as it is; it shares no Squeal results.`;

    const refusal = "squeal ci export: the parts' environments differ; wrote nothing";
    const err = `squeal ci export: Squeal's recording took 1.0 s\n${refusal}\n`;
    const refused = shared("export", { STUB_EXIT: "1", STUB_ERR: err });
    expect(refused).toMatchObject({
      code: 0,
      stdout: `::warning title=Squeal::${failed("export", 1, refusal)}\n`,
      stderr: err,
      summary: `**Squeal:** ${failed("export", 1, refusal)}\n\n`,
    });

    const crashed = shared("publish", { STUB_THROW: "100% boom" });
    expect(crashed.code).toBe(0);
    expect(crashed.stderr).toContain("Error: 100% boom");
    expect(crashed.stdout).toBe(
      `::warning title=Squeal::${failed("publish", 1, "Error: 100%25 boom")}\n`,
    );
    expect(crashed.summary).toContain(failed("publish", 1, "Error: 100% boom"));

    // The shell may name the signal ("Killed"); the exit code says it either way.
    const killed = shared("publish", { STUB_SIGNAL: "SIGKILL" });
    expect(killed.code).toBe(0);
    expect(killed.stdout).toMatch(
      /^::warning title=Squeal::squeal ci publish failed \(exit 137\)(: Killed| with no error output)\. The run's result stays as it is; it shares no Squeal results\.\n$/,
    );

    const silent = shared("export", { STUB_EXIT: "1" });
    expect(silent).toMatchObject({
      code: 0,
      stdout: `::warning title=Squeal::squeal ci export failed (exit 1) with no error output. The run's result stays as it is; it shares no Squeal results.\n`,
    });

    // A usage error is a mistake in the CI file: it fails, as the CLI's own exit code says.
    const usage = shared("export", { STUB_EXIT: "2", STUB_ERR: "usage: squeal ci export\n" });
    expect(usage).toMatchObject({ code: 2, stdout: "", stderr: "usage: squeal ci export\n" });
    expect(readdirSync(temp)).toEqual([]);
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
