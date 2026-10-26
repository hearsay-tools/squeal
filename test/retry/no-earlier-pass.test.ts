import { describe, expect, it } from "vitest";
import { createDelivery, formatDelta, formatRegistration } from "../../src/core/delivery/index.js";
import { recordedText, recordRunLoad } from "../../src/core/retry/index.js";
import { FLAKY_META_KEY, recordFlips } from "../../src/core/state/index.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../../src/core/status/index.js";
import type { Delta, FlakyNote, RecordedFacts, Store } from "../../src/core/types/index.js";
import { fixedStatus, liveDaemon } from "../delivery/fakes.js";
import { check } from "../status/helpers.js";
import { reportOf } from "../status/why-seed.js";
import { result } from "../store/helpers.js";
import { NOW, seededFailure } from "./load-retry-fixture.js";

/*
 * Row 011-253 (gh-103): a failure with no pass at its inputs on record
 * before it leads with the changed files it reads, and names its load retry
 * last, for when they are not the cause, in `why`, status and the
 * registration alike; a pass at its key before it, from any worktree, keeps
 * the line of row 011-67. A later pass's flaky note says no pass came before
 * the FAIL.
 */

const NAME = "src/auth.test.ts > auth > login";
const AUTH = check("src/auth.test.ts", "auth > login");
const NO_PASS =
  "no pass at these inputs is on record before this failure: look first at the changed files it reads";
const LOAD_RETRY = "`squeal retry src/auth.test.ts --reason load`";
const LAST = `if the changed files are not the cause, ${LOAD_RETRY} runs it once more when the one-minute load average is below the CPU count`;

/** A failure at `k1` under load 2 per CPU with no earlier pass there, as `seededFailure` stores it. */
function firstFailure() {
  const seeded = seededFailure("fail", "src/auth.test.ts", { earlierPass: false });
  recordRunLoad(seeded.store, "run-1", 2);
  return seeded;
}

/** A `pass -> fail` flip of `auth > login` at `key`, its pass from `worktreeId`. */
function flipAt(store: Store, key: string, worktreeId: string) {
  const passed = result(AUTH, key, { worktreeId, recordedAt: NOW - 90_000 });
  const failed = result(AUTH, key, { outcome: "fail", worktreeId, recordedAt: NOW - 80_000 });
  recordFlips(store, [passed], [failed], NOW - 80_000);
}

const recordedOf = (main: string) => {
  const status = readStatus(main, { now: () => NOW });
  if (!status.available) throw new Error("status not available");
  return status.knownFailures[0]?.recorded;
};

async function registrationText(seeded: ReturnType<typeof firstFailure>) {
  const { repo, store } = seeded;
  liveDaemon(store, repo.mainId);
  const delivery = createDelivery(store, { status: fixedStatus() });
  const consumer = { worktreeId: repo.mainId, sessionId: "s1", agentId: "main" };
  return formatRegistration(
    await delivery.register(consumer, { atStart: true }),
    undefined,
    "squeal",
    NOW,
  );
}

describe("a failure's earlier pass at its key (row 011-253)", () => {
  it("is none on record with no history: the changed files lead, the load retry comes last", () => {
    const { repo, store } = firstFailure();
    expect(recordedOf(repo.main)).toMatchObject({ loadPerCpu: 2, noEarlierPass: true });
    const text = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
    expect(text).toContain(
      `        ${NO_PASS}; recorded just now in this worktree at revision 4, load 2.00 per CPU when it ran; no retry asked at these inputs; ${LAST}\n`,
    );
    // Below one load per CPU it names no load retry, as before.
    recordRunLoad(store, "run-1", 0.5);
    const calm = formatStatus(readStatus(repo.main, { now: () => NOW }), NOW);
    expect(calm).toContain(
      `        ${NO_PASS}; recorded just now in this worktree at revision 4, load 0.50 per CPU when it ran; no retry asked at these inputs\n`,
    );
  });

  it("is none on record when the earlier passes were at other keys, in this worktree or another", () => {
    const seeded = firstFailure();
    flipAt(seeded.store, "k0", seeded.repo.mainId);
    flipAt(seeded.store, "k2", "wt-other");
    expect(recordedOf(seeded.repo.main)?.noEarlierPass).toBe(true);
  });

  it("is none on record when the flaky notes do not parse: missing history names no pass", () => {
    const seeded = firstFailure();
    seeded.store.meta.set(FLAKY_META_KEY, "not json");
    expect(recordedOf(seeded.repo.main)?.noEarlierPass).toBe(true);
  });

  it("is a pass at the current key, from any worktree: the load retry stays", () => {
    for (const from of ["main", "wt-other"]) {
      const seeded = firstFailure();
      flipAt(seeded.store, "k1", from === "main" ? seeded.repo.mainId : from);
      expect(recordedOf(seeded.repo.main)).not.toHaveProperty("noEarlierPass");
      const text = formatStatus(readStatus(seeded.repo.main, { now: () => NOW }), NOW);
      expect(text).toContain(`; no retry asked at these inputs; ${LOAD_RETRY} runs it once more`);
      expect(text).not.toContain("no pass at these inputs");
      expect(text).not.toContain("changed files");
    }
  });

  it("is a pass at the current key that a FAIL -> PASS note left, the FAIL back since", () => {
    const seeded = firstFailure();
    const failed = result(AUTH, "k1", { outcome: "fail", worktreeId: seeded.repo.mainId });
    recordFlips(seeded.store, [failed], [result(AUTH, "k1")], NOW - 50_000);
    expect(recordedOf(seeded.repo.main)).not.toHaveProperty("noEarlierPass");
  });

  it("reads the same in why, status and the registration", async () => {
    const seeded = firstFailure();
    const facts = recordedOf(seeded.repo.main) as RecordedFacts;
    const line = recordedText(facts, seeded.repo.mainId, NOW, {
      command: "squeal",
      path: "src/auth.test.ts",
    });
    expect(line.startsWith(NO_PASS)).toBe(true);
    const capital = `${line.charAt(0).toUpperCase()}${line.slice(1)}`;
    const why = formatWhy(reportOf(readWhy(seeded.repo.main, NAME)), "squeal", { now: NOW });
    expect(why).toContain(`\n  ${capital}\n`);
    expect(formatStatus(readStatus(seeded.repo.main, { now: () => NOW }), NOW)).toContain(
      `\n        ${line}\n`,
    );
    expect(await registrationText(seeded)).toContain(`\n      ${capital}\n`);
  });

  it("keeps the retry asked beside it, and names no load retry", () => {
    const facts: RecordedFacts = {
      worktreeId: "wt-a",
      worktreeRoot: null,
      revision: 4 as never,
      loadPerCpu: 3,
      retry: { reason: "load", outcome: "failed" },
      noEarlierPass: true,
    };
    expect(recordedText(facts, "wt-a", NOW, { command: "squeal", path: "a.test.ts" })).toBe(
      `${NO_PASS}; recorded in this worktree at revision 4, load 3.00 per CPU when it ran; retry asked (load) at these inputs: it failed again`,
    );
  });
});

describe("a later pass with no earlier pass at its key (row 011-253)", () => {
  const FLAKY =
    "Flaky: FAIL -> PASS under the same tracked inputs; no pass at these inputs is on record before the FAIL, so the flakiness may be new with the changed files it reads";

  function recovered() {
    const seeded = firstFailure();
    const failed = seeded.store.results.byKey("k1")[0];
    if (failed === undefined) throw new Error("no stored failure");
    const passed = result(AUTH, "k1", { worktreeId: seeded.repo.mainId, recordedAt: NOW });
    const [note] = recordFlips(seeded.store, [failed], [passed], NOW);
    return { ...seeded, note: note as FlakyNote };
  }

  it("is said in why and in the notice, one text", () => {
    const { repo, note } = recovered();
    expect(note.noEarlierPass).toBe(true);
    const why = formatWhy(reportOf(readWhy(repo.main, NAME)), "squeal", { now: NOW });
    expect(why).toContain(`\n  ${FLAKY} (key k1, `);
    const delta: Delta = {
      schemaVersion: 1,
      consumer: { worktreeId: repo.mainId, sessionId: "s", agentId: "main" },
      header: {
        revision: 5,
        counts: { current: 1, pending: 0, stale: 0, unknown: 0 },
        testFilesWithoutChecks: { pending: 0, unknown: 0 },
        fullSuite: { atCurrentRevision: false, lastCompletedRevision: null },
      },
      label: "transitions",
      entries: [
        {
          check: AUTH,
          kind: "fail-to-pass",
          from: "fail",
          to: "pass",
          validity: "current",
          observedAt: 5,
          origin: { kind: "own" },
          summary: null,
          location: null,
          flaky: note,
        },
      ],
    };
    expect(formatDelta(delta)).toContain(`\n      ${FLAKY}\n`);
  });

  it("reads as before once a pass at its key came first", () => {
    const seeded = seededFailure();
    const failed = seeded.store.results.byKey("k1")[0];
    if (failed === undefined) throw new Error("no stored failure");
    recordFlips(seeded.store, [failed], [result(AUTH, "k1")], NOW);
    const why = formatWhy(reportOf(readWhy(seeded.repo.main, NAME)), "squeal", { now: NOW });
    expect(why).toContain("\n  Flaky: FAIL -> PASS under the same tracked inputs (key k1, ");
  });
});
