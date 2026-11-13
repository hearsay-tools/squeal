import { afterEach, describe, expect, it } from "vitest";
import { checkpointVerdictLine } from "../../../src/cli/run.js";
import { type GroupWait, groupVerdictLine } from "../../../src/cli/run-group-wait.js";
import { lintGroupVerdictLine } from "../../../src/cli/run-lint-group.js";
import type { FileVerdict } from "../../../src/cli/verdict.js";
import type {
  CheckpointOutcome,
  GroupOutcome,
  LintGroupOutcome,
} from "../../../src/cli/wait/table.js";
import { AWAITING_INSTALL_REASON } from "../../../src/core/scheduler/install.js";
import type { ResolvedGroup } from "../../../src/core/types/check-groups.js";
import type { RevisionNumber } from "../../../src/core/types/common.js";
import { checkpointMetaKey } from "../../../src/core/types/scheduler.js";
import type { StatusHold } from "../../../src/core/types/standing.js";
import { closeLoopFixtures, ref, scratch } from "./fixture.js";

/*
 * Row 011-326: the line and exit code each run wait's outcome prints, as
 * before the move. The command-level cases the table replaced pinned these
 * lines; these rows keep them pinned, one outcome each, with no socket.
 */

afterEach(closeLoopFixtures);

const verdict: FileVerdict = {
  revision: 3,
  testFiles: 2,
  byClass: { current: 1, pending: 1, stale: 0, unknown: 0 },
  unlisted: false,
  failures: { tests: 0, testFiles: 0 },
};
const HOLD: StatusHold = { cause: "merge", since: 1, revision: 3, paths: ["a"], pathCount: 1 };
const NONE = "has no verdict:";

describe("the checkpoint wait's lines (spec 005 D1)", () => {
  const line = (outcome: CheckpointOutcome, owed = false) => {
    const w = scratch();
    const checkpoint = w.store.checkpoints.start({
      id: "c1",
      worktreeId: w.id,
      revision: 3 as RevisionNumber,
      kind: "run-all",
      testFiles: [ref("test/a.test.ts")],
      startedAt: 1,
    });
    if (owed) {
      const progress = { id: "c1", kind: "run-all", revision: 3, startedAt: 1, done: 0, total: 1 };
      const due = { ids: ["c1"], remaining: [ref("test/a.test.ts")], strict: [] };
      w.store.meta.set(checkpointMetaKey(w.id), JSON.stringify({ ...progress, owed: due }));
    }
    return checkpointVerdictLine(w.root, checkpoint, outcome, null, "squeal");
  };

  it.each<[string, CheckpointOutcome, boolean, string]>([
    [
      "moved",
      { kind: "moved", revision: 4 },
      false,
      `${NONE} revision 4 was recorded after the checkpoint's revision 3`,
    ],
    [
      "deadline",
      { kind: "deadline", verdict },
      false,
      `${NONE} the deadline passed with 1 test file pending at revision 3; the checkpoint goes on in the daemon`,
    ],
    [
      "abandoned",
      { kind: "abandoned" },
      false,
      `${NONE} it was abandoned before every test file had a result (a newer request replaced it, a test file's inputs never held still, a tier crashed or timed out, or the daemon stopped)`,
    ],
    ["stopped", { kind: "stopped" }, false, `${NONE} the daemon stopped before it ended`],
    [
      "stopped, owed to the next daemon (001-219)",
      { kind: "stopped" },
      true,
      `${NONE} the daemon stopped before it ended; the next daemon resumes it, and \`run --all --wait\` then waits for it`,
    ],
  ])("%s", (_name, outcome, owed, text) => {
    expect(line(outcome, owed)).toEqual([text, 3]);
  });

  it("on hold", () => {
    const [text, code] = line({ kind: "on-hold", hold: HOLD });
    expect(text).toMatch(/^is queued and runs when the hold ends\. \S/);
    expect(code).toBe(3);
  });
});

describe("the group wait's lines (spec 019 D6)", () => {
  const wait = (narrow: boolean): GroupWait => ({
    root: "/nowhere",
    socketPath: "/nowhere.sock",
    group: "e2e",
    queued: 1,
    deadline: 0,
    line: "",
    ...(narrow ? { files: [ref("test/e2e/a.test.ts")] } : {}),
  });
  const install = { command: "pnpm install" };

  it.each<[string, GroupOutcome, boolean, string]>([
    [
      "deadline",
      { kind: "deadline", verdict },
      false,
      `${NONE} the deadline passed with 1 test file pending at revision 3; the group goes on in the daemon`,
    ],
    [
      "deadline, narrow",
      { kind: "deadline", verdict },
      true,
      `have no verdict: the deadline passed with 1 test file pending at revision 3; their runs go on in the daemon`,
    ],
    [
      "deadline while the worktree waits for an install",
      { kind: "deadline", verdict, install },
      false,
      `${NONE} the deadline passed at revision 3 while ${AWAITING_INSTALL_REASON}, so Squeal runs none of the group's test files before the dependencies are installed; \`pnpm install\` installs them`,
    ],
    [
      "stopped",
      { kind: "stopped" },
      false,
      `${NONE} the daemon stopped before the group's test files had results`,
    ],
    [
      "stopped, narrow",
      { kind: "stopped" },
      true,
      `have no verdict: the daemon stopped before the selected test files had results`,
    ],
  ])("%s", (_name, outcome, narrow, text) => {
    expect(groupVerdictLine(wait(narrow), outcome, "squeal")).toEqual([text, 3]);
  });

  it("on hold, whole and narrow", () => {
    const hold = { kind: "on-hold", hold: HOLD } as const;
    expect(groupVerdictLine(wait(false), hold, "squeal")[0]).toMatch(
      /^is queued and runs when the hold ends\. \S/,
    );
    expect(groupVerdictLine(wait(true), hold, "squeal")).toEqual([
      expect.stringMatching(/^are queued and run when the hold ends\. \S/),
      3,
    ]);
  });
});

describe("the lint group wait's lines (row 019-22)", () => {
  const group = { name: "lint", at: "commit" } as ResolvedGroup;
  const counts = { files: 2, failing: 0, linting: 2, held: 0, unknown: 0 };

  it.each<[string, LintGroupOutcome, string]>([
    ["off", { kind: "off" }, `${NONE} lint is off: lint.enabled is false in squeal.config.json`],
    ["unread", { kind: "unread" }, `${NONE} the lint store cannot be read`],
    [
      "stopped",
      { kind: "stopped" },
      `${NONE} the daemon stopped before the group's lint checks were linted`,
    ],
    [
      "deadline",
      { kind: "deadline", counts },
      `${NONE} the deadline passed with 2 lint checks pending; the group goes on in the daemon`,
    ],
  ])("%s", (_name, outcome, text) => {
    expect(lintGroupVerdictLine(outcome, group)).toEqual([text, 3]);
  });
});
