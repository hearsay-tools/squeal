import { afterEach, describe, expect, it } from "vitest";
import { checkpointVerdictLine, recordedOf } from "../../../src/cli/run.js";
import { type GroupWait, groupVerdictLine } from "../../../src/cli/run-group-wait.js";
import { lintGroupVerdictLine } from "../../../src/cli/run-lint-group.js";
import { pendingText } from "../../../src/cli/run-slow.js";
import type { FileVerdict } from "../../../src/cli/verdict.js";
import type {
  CheckpointOutcome,
  DaemonDown,
  GroupOutcome,
  LintGroupOutcome,
} from "../../../src/cli/wait/table.js";
import { AWAITING_INSTALL_REASON } from "../../../src/core/scheduler/install.js";
import type { ResolvedGroup } from "../../../src/core/types/check-groups.js";
import type { RevisionNumber } from "../../../src/core/types/common.js";
import type { RunAllResponse } from "../../../src/core/types/daemon.js";
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
/** Row 011-327: daemon presence's readings a stopped wait names, in the status waits' words. */
const STOPPED: DaemonDown = {
  state: "down",
  reason: "stopped",
  liveness: { state: "down", since: Date.UTC(2026, 10, 13, 21) },
};
const SINCE = "no daemon has validated since 2026-11-13T21:00:00.000Z";
const SILENT: DaemonDown = { ...STOPPED, reason: "silent" };
const HANDOFF: DaemonDown = {
  ...STOPPED,
  reason: "handoff",
  liveness: {
    state: "down",
    since: 1,
    stopping: { from: "0.1.30", since: 1, to: "0.1.31", boundAt: 2, overdue: true },
  },
} as DaemonDown;

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
    [
      "stopped: squeal stop cleared the record, named (011-327)",
      { kind: "stopped", daemon: STOPPED },
      false,
      `${NONE} the daemon stopped before it ended (${SINCE}: the daemon stopped)`,
    ],
    [
      "stopped: a handoff past its bound, named (011-327)",
      { kind: "stopped", daemon: HANDOFF },
      false,
      `${NONE} the daemon stopped before it ended (the handoff to 0.1.31 did not finish within 130 s; \`squeal start\` finishes it)`,
    ],
    [
      "unopened: why the store was not read (011-327)",
      { kind: "unopened", unavailable: "no Squeal store at /r/.git/squeal/store.sqlite" },
      false,
      `${NONE} no Squeal store at /r/.git/squeal/store.sqlite`,
    ],
    [
      "stopped, owed to the next daemon (001-219)",
      { kind: "stopped", daemon: STOPPED },
      true,
      `${NONE} the daemon stopped before it ended (${SINCE}: the daemon stopped); the next daemon resumes it, and \`run --all --wait\` then waits for it`,
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
      "stopped: a daemon that died, named (011-327)",
      { kind: "stopped", daemon: SILENT },
      false,
      `${NONE} the daemon stopped before the group's test files had results (${SINCE}: its heartbeat stopped and nothing listens on its socket)`,
    ],
    [
      "stopped, narrow",
      { kind: "stopped", daemon: STOPPED },
      true,
      `have no verdict: the daemon stopped before the selected test files had results (${SINCE}: the daemon stopped)`,
    ],
    [
      "unopened: why the store was not read (011-327)",
      {
        kind: "unopened",
        unavailable: "store version newer than this Squeal (store 9, supported 8)",
      },
      false,
      `${NONE} store version newer than this Squeal (store 9, supported 8)`,
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
      "stopped, named (011-327)",
      { kind: "stopped", daemon: STOPPED },
      `${NONE} the daemon stopped before the group's lint checks were linted (${SINCE}: the daemon stopped)`,
    ],
    [
      "deadline",
      { kind: "deadline", counts },
      `${NONE} the deadline passed with 2 lint checks pending; the group goes on in the daemon`,
    ],
  ])("%s", (_name, outcome, text) => {
    expect(lintGroupVerdictLine(outcome, group, "squeal")).toEqual([text, 3]);
  });
});

describe("a request the daemon did not answer within its bound (row 011-327)", () => {
  it("run --all: a busy daemon, worded as no verdict, not a stack", () => {
    const answer = { requestId: "r1" } as RunAllResponse;
    expect(recordedOf({ kind: "unanswered", answer, words: " within 2 s" })).toBe(
      "the daemon did not answer about request r1 within 2 s; the daemon records the checkpoint once its current work allows",
    );
    expect(recordedOf({ kind: "pending", answer })).toBeNull();
  });

  it("run --slow: a busy daemon, worded as a pending request, not a stack", () => {
    const busy = { pending: "s1", unanswered: " within 2 s" };
    expect(pendingText(busy, null)).toBe(
      "Slow tier requested (request s1); the daemon did not answer about it within 2 s and takes it once its current work allows\n",
    );
    expect(pendingText(busy, 2_100)).toBe(
      "Returned without a verdict after 2.1 s: the daemon did not answer about slow tier request s1 within 2 s; the request is pending and this command has no verdict for it. The daemon takes it once its current work allows; `squeal status --wait 60000 <slow test file>` then waits for that file's result.\n",
    );
    expect(pendingText({ pending: "s1" }, 2_100)).toMatch(
      /^Returned on timeout after 2\.1 s: the daemon has not taken slow tier request s1 yet; /,
    );
  });
});
