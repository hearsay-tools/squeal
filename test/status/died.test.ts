import { describe, expect, it } from "vitest";
import { formatDelta } from "../../src/core/delivery/index.js";
import { DIED_FILES_SHOWN, deathText } from "../../src/core/status/died.js";
import type { DaemonLiveness, Delta } from "../../src/core/types/index.js";

/*
 * Task 001-263: how a daemon that died without shutting down is worded. The
 * real death, in status and the next hook, is `test/daemon/died.test.ts`.
 */

const AT = Date.UTC(2026, 9, 11, 13, 0);
const ISO = new Date(AT).toISOString();

function files(n: number) {
  return Array.from({ length: n }, (_, i) => ({ project: "", path: `test/${i}.test.ts` }));
}

function delta(daemon: DaemonLiveness): Delta {
  return {
    schemaVersion: 1,
    consumer: { worktreeId: "wt", sessionId: "s", agentId: "main" },
    header: {
      revision: 4,
      counts: { current: 1, pending: 0, stale: 0, unknown: 0 },
      testFilesWithoutChecks: { pending: 0, unknown: 0 },
      fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      daemon,
    },
    label: "transitions",
    entries: [],
    liveness: daemon,
  };
}

describe("deathText (task 001-263)", () => {
  it("names each open run with its first files, and says between runs with none", () => {
    expect(deathText({ runs: [] })).toBe("died without shutting down, between runs");
    const runs = [
      { id: "r1", revision: 3, testFiles: files(DIED_FILES_SHOWN + 2) },
      { id: "r2", revision: 3, testFiles: [{ project: "slow", path: "test/s.test.ts" }] },
    ];
    expect(deathText({ runs })).toBe(
      "died without shutting down, during run r1 (revision 3) of test/0.test.ts, test/1.test.ts, " +
        "test/2.test.ts, test/3.test.ts, test/4.test.ts and 2 more; run r2 (revision 3) of [slow] test/s.test.ts",
    );
  });
});

describe("a hook header naming a dead daemon (task 001-263)", () => {
  const died = { runs: [{ id: "r1", revision: 3, testFiles: files(1) }] };
  const said =
    "The last daemon died without shutting down, during run r1 (revision 3) of test/0.test.ts. " +
    "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

  it("says it died after since when none validated", () => {
    const text = formatDelta(delta({ state: "down", since: AT, died }));
    expect(text).toContain(
      ` No daemon has validated since ${ISO}; results are as of revision 4. ${said}`,
    );
  });

  it("says it died after a successor that is starting", () => {
    const text = formatDelta(delta({ state: "down", since: AT, startingSince: AT + 1, died }));
    expect(text).toContain(` A daemon is starting; results are as of revision 4. ${said}`);
  });
});
