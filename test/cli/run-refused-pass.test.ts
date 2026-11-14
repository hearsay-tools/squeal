import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CliIo, main } from "../../src/cli/main.js";
import { socketPathFor } from "../../src/core/daemon/paths.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import { REINSTALLED_REASON } from "../../src/core/scheduler/narrow-run.js";
import { squealRepo } from "../harness/helpers.js";
import { closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";

/*
 * Row 011-337: the run commands word a refused pass and an install wait for
 * the request they made, against a stand-in daemon. Since row 011-335 the
 * daemon refuses a group, narrow, slow or lint request with `NO_PASS` when
 * no reconciliation pass started after it (row 011-198); the stand-in
 * answers each with the words the intake gives that request
 * (`request-intake-group.test.ts`), which the command prints as they come.
 */

const saved = { ...process.env };
let runtimeDir: string;

beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});

afterEach(() => {
  closeFakeDaemons();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/** A repository with a test group `unit` and a lint group `lint`. */
function repo() {
  const r = squealRepo();
  const checks = [
    { name: "unit", runner: "vitest", tests: ["test/**"], at: "edit" },
    { name: "lint", lint: true, at: "commit" },
  ];
  writeFileSync(join(r.root, "squeal.config.json"), JSON.stringify({ checks }));
  return r;
}

const PASS =
  "the change feed delivered no reconciliation pass that started after the request " +
  "(its pass failed, or the daemon closed first)";
/** A daemon's refusal before row 011-337, for every request. */
const BEFORE = `${PASS}, so no checkpoint was planned`;

type Taken = { revision: number; queued: number; installWait?: string } | null;

function group(name: string, error: string | null = null) {
  const answer = { ok: true, type: "run-group", requestId: "g1", group: name, requested: null };
  return { ...answer, unknown: false, error };
}

function slow(requested: Taken, error: string | null = null) {
  return { ok: true, type: "run-slow", requestId: "s1", requested, error };
}

/** The request each command sends, refused once the scheduler tried to take it. */
function refusing(name: string, request: string, error: string) {
  if (request === "run-slow") {
    return { "run-slow": [slow(null)], "run-slow-status": [slow(null, error)] };
  }
  return { [request]: [group(name)], "run-group-status": [group(name, error)] };
}

async function run(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
  };
  const code = await main(argv, io);
  return { code, stdout, stderr };
}

/** Per command: its words, the request it sends and group, and what it prints without and with `--wait`. */
const GROUP = `${PASS}, so nothing was queued for group unit`;
const NARROW = `${PASS}, so no test file of group unit that the paths select was queued`;
const LINT = `${PASS}, so nothing was queued for group lint`;
const SLOW = `${PASS}, so nothing was queued for group slow`;
const COMMANDS = [
  {
    argv: ["run", "unit"],
    request: "run-group",
    group: "unit",
    refused: GROUP,
    without: `squeal: squeal run unit failed: ${GROUP}\n`,
    waited: { code: 3, stdout: `No verdict: squeal run unit failed: ${GROUP}\n`, stderr: "" },
  },
  {
    argv: ["run", "unit", "test/a.test.ts"],
    request: "run-group-paths",
    group: "unit",
    refused: NARROW,
    without: `squeal: squeal run unit failed: ${NARROW}\n`,
    waited: { code: 3, stdout: `No verdict: squeal run unit failed: ${NARROW}\n`, stderr: "" },
  },
  {
    argv: ["run", "lint"],
    request: "run-group",
    group: "lint",
    refused: LINT,
    without: `squeal: squeal run lint failed: ${LINT}\n`,
    waited: {
      code: 3,
      stdout: `Group lint has no verdict: squeal run lint failed: ${LINT}\n`,
      stderr: "",
    },
  },
  {
    argv: ["run", "--slow"],
    request: "run-slow",
    group: "slow",
    refused: SLOW,
    without: `squeal: run --slow failed: ${SLOW}\n`,
    waited: { code: 3, stdout: `No verdict: run --slow failed: ${SLOW}\n`, stderr: "" },
  },
];

describe("the run commands word a refused pass for the request they made (row 011-337)", () => {
  it.each(COMMANDS)("$argv: exit 1 without --wait", async (command) => {
    const r = repo();
    const answers = refusing(command.group, command.request, command.refused);
    await fakeDaemon(socketPathFor(r.worktreeId), answers);
    expect(await run(command.argv, r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr: command.without,
    });
  });

  it.each(COMMANDS)("$argv --wait: no verdict", async (command) => {
    const r = repo();
    const answers = refusing(command.group, command.request, command.refused);
    await fakeDaemon(socketPathFor(r.worktreeId), answers);
    expect(await run([...command.argv, "--wait", "5000"], r.root)).toEqual(command.waited);
  });

  it("run --slow --wait: a daemon before the row refuses in its words, also no verdict", async () => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), refusing("slow", "run-slow", BEFORE));
    expect(await run(["run", "--slow", "--wait", "5000"], r.root)).toEqual({
      code: 3,
      stdout: `No verdict: run --slow failed: ${BEFORE}\n`,
      stderr: "",
    });
  });

  it("run --slow --wait: any other failure keeps exit 1", async () => {
    const r = repo();
    const error = "squeal scheduler: not started";
    await fakeDaemon(socketPathFor(r.worktreeId), refusing("slow", "run-slow", error));
    expect(await run(["run", "--slow", "--wait", "5000"], r.root)).toEqual({
      code: 1,
      stdout: "",
      stderr: `squeal: run --slow failed: ${error}\n`,
    });
  });
});

describe("run --slow names the install wait its answer carries (row 011-337)", () => {
  it.each([AWAITING_INSTALL_REASON, REINSTALLED_REASON])("%s", async (reason) => {
    const r = repo();
    await fakeDaemon(socketPathFor(r.worktreeId), {
      "run-slow": [slow({ revision: 5, queued: 0, installWait: reason })],
    });
    expect(await run(["run", "--slow"], r.root)).toEqual({
      code: 0,
      stdout: `No slow files run at revision 5: ${reason}.\n`,
      stderr: "",
    });
  });
});
