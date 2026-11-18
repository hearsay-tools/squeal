import { describe, expect, it } from "vitest";
import { formatDelta, notValidatedLine } from "../../src/core/delivery/format.js";
import { headerParts } from "../../src/core/delivery/header.js";
import { DIED_FILES_SHOWN, deathHookText, deathText } from "../../src/core/status/died.js";
import { utcTimeText } from "../../src/core/text.js";
import type { Delta } from "../../src/core/types/delivery.js";
import type { DaemonLiveness } from "../../src/core/types/status.js";

/*
 * Task 001-263: how a daemon that died without shutting down is worded. The
 * real death, in status and the next hook, is `test/daemon/died.test.ts`.
 */

const AT = Date.UTC(2026, 9, 11, 13, 0);
const UTC = utcTimeText(AT);

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

describe("deathHookText (row 005-116)", () => {
  it("names the test files of every open run, with no run id or revision", () => {
    expect(deathHookText({ runs: [] })).toBe("died without shutting down, between runs");
    const runs = [
      { id: "r1", revision: 3, testFiles: files(DIED_FILES_SHOWN - 1) },
      {
        id: "r2",
        revision: 3,
        testFiles: [{ project: "slow", path: "test/s.test.ts" }, ...files(2)],
      },
    ];
    expect(deathHookText({ runs })).toBe(
      "died without shutting down while running test/0.test.ts, test/1.test.ts, test/2.test.ts, " +
        "test/3.test.ts, [slow] test/s.test.ts and 2 more",
    );
  });
});

describe("a hook header naming a dead daemon (task 001-263, row 005-116)", () => {
  const died = { runs: [{ id: "r1", revision: 3, testFiles: files(1) }] };
  const said =
    "The last daemon died without shutting down while running test/0.test.ts. " +
    "A SIGKILL, or a test that signals its own process group (`kill(0, ...)`), ends a daemon this way.";

  it("says it died after since when none validated", () => {
    const text = formatDelta(delta({ state: "down", since: AT, died }));
    expect(text).toContain(
      ` No daemon has validated since ${UTC}; results are as of revision 4. ${said} \`squeal start\` starts one.`,
    );
    expect(text).not.toContain("r1");
    expect(text).not.toContain("revision 3");
  });

  it("says it died after a successor that is starting", () => {
    const text = formatDelta(delta({ state: "down", since: AT, startingSince: AT + 1, died }));
    expect(text).toContain(` A daemon is starting; results are as of revision 4. ${said}`);
    expect(text).not.toContain("squeal start");
  });
});

describe("the Not validated line beside a death (row 005-116, review 0.1.554 B2)", () => {
  const died = { runs: [{ id: "r1", revision: 3, testFiles: files(1) }] };
  const down = { state: "down", since: AT, died } as const;

  it("names the death and `squeal start` when the header did not", () => {
    expect(notValidatedLine(down)).toBe(
      `Not validated: no daemon has validated since ${UTC}; the last daemon died without shutting down while running test/0.test.ts; \`squeal start\` starts one; any change this call made has no result.`,
    );
  });

  it("leaves both to a header that said them", () => {
    expect(notValidatedLine(down, "squeal", { deathTold: true })).toBe(
      `Not validated: no daemon has validated since ${UTC}; any change this call made has no result.`,
    );
  });

  it("never says `squeal start` while a successor is starting", () => {
    expect(notValidatedLine({ ...down, startingSince: AT + 1 })).not.toContain("squeal start");
  });
});

describe("headerParts' input (review 0.1.554 S1)", () => {
  it("takes the late line it leaves the delay to", () => {
    const listing = {
      ...delta({ state: "alive", lastHeartbeatAt: AT }).header,
      runnerPartPending: true,
    };
    expect(headerParts(listing, "squeal", "news").line).toContain("not yet listed");
    const parts = headerParts(listing, "squeal", "news", {
      editsLate: { kind: "unlisted", revision: 4 },
    });
    expect(parts.line).not.toContain("not yet listed");
  });
});
