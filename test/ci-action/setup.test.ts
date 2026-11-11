import { spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BROKEN_CLI,
  type Checkout,
  checkout,
  NODE_PATH,
  REPO,
  step,
  workflowFiles,
} from "./checkout.js";

/*
 * Spec 018 D20, row 018-33 item 1: `uses: hearsay-tools/squeal/ci@v0` runs
 * the composite action `ci/action.yml`, whose one step runs `ci/setup.sh`.
 * It puts `ci/bin` on the job's PATH, checks that Squeal can run with the
 * node on the PATH, and always exits 0: when Squeal cannot run, it warns in
 * the job log and the step summary, and `squeal` passes through.
 */

const ACTION = readFileSync(join(REPO, "ci/action.yml"), "utf8");

/** The action's one step: its shell and its script, as `action.yml` states them. */
function actionStep(): { shell: string; run: string } {
  expect(ACTION).toMatch(/^runs:\n {2}using: composite\n {2}steps:\n/m);
  expect(ACTION).not.toMatch(/^inputs:/m);
  const shell = /^ {6}shell: (\w+)$/m.exec(ACTION)?.[1];
  const run = /^ {6}run: (.+)$/m.exec(ACTION)?.[1];
  expect(ACTION.match(/^ {4}- /gm)).toHaveLength(1);
  if (shell === undefined || run === undefined) throw new Error("ci/action.yml has no run step");
  return { shell, run };
}

/** The action's step as GitHub runs it, in `at`. */
function runAction(at: Checkout, env: Record<string, string> = {}) {
  const { shell, run } = actionStep();
  return step(at, shell, ["-c", run], { GITHUB_ACTION_PATH: at.action, ...env });
}

const PASS_THROUGH =
  "The squeal command passes through: squeal ci record runs the command without recording, and squeal ci export and squeal ci publish do nothing. Each squeal call checks again, so a Node that a later step puts on the PATH counts there.";

describe("the action's setup", () => {
  it("puts ci/bin on the PATH and names the Squeal and the Node it runs", () => {
    const at = checkout();
    const ran = runAction(at);
    expect(ran).toMatchObject({ code: 0, stderr: "", summary: "" });
    expect(ran.stdout).toBe(
      `Squeal 9.9.9 on Node ${process.version}: squeal ci record, squeal ci export and squeal ci publish are on the PATH.\n`,
    );
    expect(ran.calls).toEqual([["--version"]]);
    expect(workflowFiles(at)).toEqual({ path: `${at.action}/bin\n`, env: "" });
  });

  it("warns and exits 0 when node on the PATH is older than Squeal's floor", () => {
    const at = checkout({ floor: "999.0" });
    const ran = runAction(at);
    const problem = `Squeal needs Node 999.0 or later, and node is ${process.versions.node}`;
    expect(ran).toMatchObject({
      code: 0,
      stdout: `::warning title=Squeal::Squeal cannot run here: ${problem}. ${PASS_THROUGH}\n`,
      summary: `**Squeal:** Squeal cannot run here: ${problem}. ${PASS_THROUGH}\n\n`,
      calls: [],
    });
    // The PATH still gets `squeal`, which checks node again at each call.
    expect(workflowFiles(at)).toEqual({ path: `${at.action}/bin\n`, env: "" });
  });

  it("warns, exits 0 and makes squeal pass through when the CLI does not start", () => {
    const at = checkout({ cli: BROKEN_CLI });
    const ran = runAction(at);
    expect(ran.code).toBe(0);
    expect(ran.stdout).toMatch(
      /^::warning title=Squeal::Squeal cannot run here: Squeal's CLI does not start on Node v\d+\.\d+\.\d+: .+\. The squeal command passes through:/,
    );
    const { env } = workflowFiles(at);
    const failed = /^SQUEAL_CI_SETUP_FAILED=(Squeal's CLI does not start on Node .+)\n$/.exec(env);
    expect(failed).not.toBeNull();
    // A later step's environment holds what setup wrote to $GITHUB_ENV.
    const later = { SQUEAL_CI_SETUP_FAILED: failed?.[1] ?? "" };
    const record = step(at, join(at.action, "bin/squeal"), ["ci", "record", "--", "true"], later);
    expect(record.code).toBe(0);
    expect(record.stdout).toContain("Squeal cannot run here: Squeal's CLI does not start");
  });

  it("exits 0 even when its script fails", () => {
    const at = checkout();
    writeFileSync(join(at.action, "setup.sh"), "exit 7\n");
    expect(runAction(at).code).toBe(0);
  });

  it("in this repository: an executable squeal that runs the committed CLI", () => {
    const wrapper = join(REPO, "ci/bin/squeal");
    expect(statSync(wrapper).mode & 0o111).toBe(0o111);
    const run = spawnSync(wrapper, ["--version"], { encoding: "utf8", env: { PATH: NODE_PATH } });
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^\d+\.\d+\.\d+\n$/);
  });
});
