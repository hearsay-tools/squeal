import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CommitReport } from "../../src/core/commit/report.js";
import {
  readCommitReports,
  replaceCommitReport,
  writeCommitReports,
} from "../../src/core/commit/store.js";
import { createDelivery } from "../../src/core/delivery/delivery.js";
import { formatDelta } from "../../src/core/delivery/format.js";
import { createStateSink } from "../../src/core/state/sink.js";
import type { Consumer, HarnessDelivery } from "../../src/core/types/delivery.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { check, freshStore, result, setKey, WT } from "../state/helpers.js";
import { fixedStatus, liveDaemon } from "./fakes.js";

/*
 * Row 019-22 (spec 019 D5 steps 3 and 4): a commit report with running
 * checks reaches a consumer once, and its one update once more, as a change
 * at the next tool boundary; nothing holds the agent for it. Row 019-38
 * (lessons Round 2 P8): a Stop tells a report or update no boundary told,
 * once, and the next boundary does not repeat it.
 */

const FILE: TestFileRef = { project: "", path: "test/a.test.ts" };
const UNIT = check("unit", FILE);
const C1: Consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };
const CHECKS = { checks: [{ name: "ci", runner: "vitest", tests: ["test/**"], at: "commit" }] };
const RUNNING: CommitReport = {
  commit: "abc1234def5678",
  revision: 1,
  at: 1,
  tests: { files: 1, failures: 0, notDetermined: 0, running: 1, unknown: 0 },
  waiting: { tests: [{ project: "", path: FILE.path, key: "k1" }], lint: [] },
};
const UPDATED: CommitReport = {
  commit: RUNNING.commit,
  revision: 1,
  at: 2,
  tests: { files: 1, failures: 1, notDetermined: 0, running: 0, unknown: 0 },
  updated: true,
};

let root: string;
let store: Store;
let delivery: HarnessDelivery;
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function registered(): Promise<void> {
  root = mkdtempSync(join(tmpdir(), "squeal-019-22-"));
  writeFileSync(join(root, "squeal.config.json"), JSON.stringify(CHECKS));
  store = freshStore();
  store.worktrees.upsert({
    id: WT,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  liveDaemon(store, WT);
  setKey(store, "k1", { file: FILE });
  const at = store.revisions.append({
    worktreeId: WT,
    createdAt: 1,
    head: null,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/x.ts", oldHash: null, newHash: "h" }],
  }).number;
  const results = [result(UNIT, "pass", { key: "k1" })];
  store.results.putMany(results);
  createStateSink(store).applyResults(WT, at, results, { checkpointId: null });
  delivery = createDelivery(store, { status: fixedStatus() });
  await delivery.register(C1, { atStart: true });
}

const commitLine = async (stop = false) => {
  const d = await delivery.onToolBoundary(C1, { stop });
  return d === null
    ? null
    : formatDelta(d)
        .split("\n")
        .find((l) => l.startsWith("Commit "));
};

describe("a commit report's one update (019-22)", () => {
  it("tells the report, then its update, each once", async () => {
    await registered();
    writeCommitReports(store.meta, WT, RUNNING.commit, RUNNING);
    expect(await commitLine()).toBe("Commit abc1234: 0 known failures; 1 test file still running");
    expect(await commitLine()).toBeNull();

    replaceCommitReport(store.meta, WT, UPDATED);
    expect(await commitLine()).toBe("Commit abc1234: 1 known failure");
    expect(await commitLine()).toBeNull();
  });

  it("a Stop tells the report, then its update, each once; a later Stop or boundary does not (019-38)", async () => {
    await registered();
    writeCommitReports(store.meta, WT, RUNNING.commit, RUNNING);
    expect(await commitLine(true)).toBe(
      "Commit abc1234: 0 known failures; 1 test file still running",
    );
    expect(await commitLine(true)).toBeNull();
    expect(await commitLine()).toBeNull();

    replaceCommitReport(store.meta, WT, UPDATED);
    expect(await commitLine(true)).toBe("Commit abc1234: 1 known failure");
    expect(await commitLine(true)).toBeNull();
    expect(await commitLine()).toBeNull();
  });

  it("a Stop tells the update a boundary did not, after the report it did (019-38)", async () => {
    await registered();
    writeCommitReports(store.meta, WT, RUNNING.commit, RUNNING);
    expect(await commitLine()).not.toBeNull();
    replaceCommitReport(store.meta, WT, UPDATED);
    expect(await commitLine(true)).toBe("Commit abc1234: 1 known failure");
    expect(await commitLine()).toBeNull();
  });

  it("an older report drops its wait once a newer one is made; an update keeps its place", async () => {
    await registered();
    writeCommitReports(store.meta, WT, RUNNING.commit, RUNNING);
    const { updated: _, ...newer } = { ...UPDATED, commit: "fff0000" };
    writeCommitReports(store.meta, WT, newer.commit, newer);
    expect(readCommitReports(store.meta, WT)?.reports[1]).not.toHaveProperty("waiting");
    replaceCommitReport(store.meta, WT, { ...UPDATED, at: 3 });
    const reports = readCommitReports(store.meta, WT)?.reports ?? [];
    expect(reports.map((r) => r.commit)).toEqual(["fff0000", RUNNING.commit]);
    expect(reports[1]).toMatchObject({ at: 3, updated: true });
  });
});
