import { describe, expect, it } from "vitest";
import { headerLines, readHeader } from "../../src/core/delivery/index.js";
import { formatWhy, readFailures, readWhy } from "../../src/core/status/index.js";
import type { WhyReport, WhyResult } from "../../src/core/types/index.js";
import { result } from "../store/helpers.js";
import {
  focusedRun,
  keyOf,
  PARITY,
  seedFile,
  test,
  worktree,
  writeRuns,
} from "./focused-fixture.js";

/*
 * Row 011-146 (011 C6 as amended 2026-10-23): `why <check>` names the
 * check's newest focused run below its known state, and says when the
 * entry no longer applies; `--json` adds `focused`. `failures` and the
 * hooks' header show nothing of a focused run.
 */

const NAME = "claude U2 ci and timer open";

function reportOf(why: WhyResult): WhyReport {
  if (!why.available || !why.found) throw new Error("no report");
  return why;
}

const focusedLine = (why: WhyReport) =>
  formatWhy(why)
    .split("\n")
    .find((l) => l.startsWith("  Focused run"));

describe("why names a focused run of the check (011 C6, row 011-146)", () => {
  it("below the known state: its revision, time, log and outcome, never a stored result", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued", [NAME]);
    writeRuns(store, id, [focusedRun(PARITY)]);

    const why = reportOf(readWhy(repo.main, `${PARITY} > ${NAME}`));
    const lines = formatWhy(why).split("\n");

    const at = lines.findIndex((l) => l.startsWith("Known state:"));
    expect(lines[at + 1]).toBe(
      "  Focused run at revision 4 (7.8 s, log /tmp/squeal-logs/run-focused): FAIL, not a stored result; the file's own run decides",
    );
    expect(why.focused).toMatchObject({
      keyMoved: false,
      run: { applies: true, revision: 4, runId: "run-focused" },
      result: { outcome: "fail", summary: "AssertionError: expected 'a' to contain 'b'" },
    });
    // Never a stored result: none listed, and the known state is the queue's.
    expect(why.results).toEqual([]);
    expect(why.knownState?.validity).toBe("pending");
  });

  it("after a key move it says so; after the file's own result at the key, that", () => {
    const moved = worktree();
    seedFile(moved.store, moved.id, PARITY, "queued", [NAME], keyOf(PARITY, 2));
    writeRuns(moved.store, moved.id, [focusedRun(PARITY)]);
    const stored = worktree();
    seedFile(stored.store, stored.id, PARITY, null, [NAME]);
    stored.store.results.putMany([result(test(PARITY, NAME), keyOf(PARITY))]);
    writeRuns(stored.store, stored.id, [focusedRun(PARITY)]);

    const afterMove = reportOf(readWhy(moved.repo.main, `${PARITY} > ${NAME}`));
    const afterRun = reportOf(readWhy(stored.repo.main, `${PARITY} > ${NAME}`));

    expect(focusedLine(afterMove)).toMatch(/the file's own run decides; its key moved since$/);
    expect(afterMove.focused).toMatchObject({ keyMoved: true, run: { applies: false } });
    expect(focusedLine(afterRun)).toMatch(
      /the file's own run decides; the file's own run stored its result at this key since$/,
    );
    expect(afterRun.focused).toMatchObject({ keyMoved: false, run: { applies: false } });
  });

  it("names nothing for a check the focused run did not select", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued", [NAME, "codex U1"]);
    writeRuns(store, id, [focusedRun(PARITY)]);

    const why = reportOf(readWhy(repo.main, `${PARITY} > codex U1`));

    expect(focusedLine(why)).toBeUndefined();
    expect(why.focused).toBeUndefined();
  });
});

describe("why finds a check first seen in a focused run (011 C6, review 0.1.286 B3)", () => {
  const NEW = "newly added";

  /** PARITY queued at its key with no check of its own yet; a focused run failed `newly added`. */
  function firstSeen(key = keyOf(PARITY)) {
    const w = worktree();
    seedFile(w.store, w.id, PARITY, "queued", [], key);
    writeRuns(w.store, w.id, [focusedRun(PARITY, { texts: ["newly"], fails: [NEW] })]);
    return w;
  }

  it("by its exact name and by a unique part of it, with no known state, history or duration", () => {
    const { repo } = firstSeen();

    for (const query of [`${PARITY} > ${NEW}`, "newly add"]) {
      const why = reportOf(readWhy(repo.main, query));
      expect(why.check).toEqual(test(PARITY, NEW));
      expect(focusedLine(why)).toBe(
        "  Focused run at revision 4 (7.8 s, log /tmp/squeal-logs/run-focused): FAIL, not a stored result; the file's own run decides",
      );
      expect(why.knownState).toBeNull();
      expect(why.history).toEqual([]);
      expect(why.results).toEqual([]);
      expect(why.durations).toBeNull();
    }
  });

  it("after a key move, with the moved line", () => {
    const { repo } = firstSeen(keyOf(PARITY, 2));

    const why = reportOf(readWhy(repo.main, `${PARITY} > ${NEW}`));

    expect(focusedLine(why)).toMatch(/the file's own run decides; its key moved since$/);
    expect(why.focused).toMatchObject({ keyMoved: true, run: { applies: false } });
  });

  it("a part two checks hold stays ambiguous; a run in flight names nothing", () => {
    const shared = worktree();
    seedFile(shared.store, shared.id, PARITY, "queued", [`${NEW} twice`]);
    writeRuns(shared.store, shared.id, [
      focusedRun(PARITY, { texts: ["newly"], fails: [`${NEW} once`] }),
    ]);
    const running = worktree();
    seedFile(running.store, running.id, PARITY, "queued", []);
    writeRuns(running.store, running.id, [
      focusedRun(PARITY, { fails: [], endedAt: null, end: null, matched: null }),
    ]);

    const ambiguous = readWhy(shared.repo.main, NEW);
    const none = readWhy(running.repo.main, `${PARITY} > ${NEW}`);

    expect(ambiguous).toMatchObject({ found: false });
    if (ambiguous.available && !ambiguous.found) expect(ambiguous.candidates).toHaveLength(2);
    expect(none).toMatchObject({ found: false });
  });
});

describe("failures and the hooks show nothing of a focused run (011 C5, row 011-146)", () => {
  it("lists no failure and counts none in the delivered header", () => {
    const { repo, store, id } = worktree();
    seedFile(store, id, PARITY, "queued", [NAME]);
    writeRuns(store, id, [focusedRun(PARITY)]);

    const failures = readFailures(repo.main);
    if (!failures.available) throw new Error(failures.message);
    expect(failures.total).toBe(0);
    // The hooks' header counts the queue's pending check, as without the focused run.
    const header = readHeader(store, id);
    expect(header.counts).toMatchObject({ current: 0, pending: 1 });
    expect(headerLines(header, "squeal").join("\n")).not.toMatch(/Focused|FAIL|claude U2/);
  });
});
