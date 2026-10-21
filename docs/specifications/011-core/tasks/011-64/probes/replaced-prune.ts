// THROWAWAY probe (011-64 design, question 3). On a scratch store: a fail, then a pass at the
// same key (as `storeResults` stores a passing retry), then the daemon's prune an hour later
// and eight days later. Prints what is left of the failure: its text, its run, its log.
// Run from the repository root with a scratch HOME and XDG_* (see README.md):
//   <tsx> docs/specifications/011-core/tasks/011-64/probes/replaced-prune.ts
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { worktreeIdFor } from "../../../../../../src/core/fs/index.js";
import { recordFlips, readFlakyNotes } from "../../../../../../src/core/state/flaky.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../../../../../src/core/store/index.js";
import type { ResultRecord } from "../../../../../../src/core/types/index.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-011-64-")));
const commonDir = join(root, ".git");
mkdirSync(commonDir);
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
const store = openStore(commonDir, { busyTimeoutMs: 10_000 });
if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
const wt = worktreeIdFor(root);
store.worktrees.upsert({ id: wt, root, commonDir, isMain: true, registeredAt: 1, daemon: null } as never);

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const KEY = "k1";
const check = { kind: "test" as const, project: "", testPath: "test/a.test.ts", fullName: "flips" };
const runsDir = storePaths(commonDir).runsDir;
for (const [id, at] of [["run-fail", NOW - 2 * 60_000], ["run-pass", NOW - 60_000]] as const) {
  const logDir = join(runsDir, id);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(join(logDir, "vitest.log"), `${id}\n`);
  store.runs.start({ id, worktreeId: wt, revision: 3, testFiles: [{ project: "", path: check.testPath }], checkpointId: null, logDir, startedAt: at } as never);
  store.runs.finish(id, "completed" as never, at + 1_000);
}
const row = (outcome: "pass" | "fail", runId: string, recordedAt: number): ResultRecord =>
  ({
    check, key: KEY, outcome, durationMs: 12, location: null,
    fingerprint: outcome === "fail" ? "Error: boom @ test/helper.ts:3:9" : null,
    summary: outcome === "fail" ? "boom" : null,
    errors: outcome === "fail"
      ? [{ name: "Error", message: "boom", stack: "Error: boom\n    at helper (test/helper.ts:3:9)\n    at test/a.test.ts:12:5", location: { path: "test/helper.ts", line: 3, column: 9 }, diff: null }]
      : [],
    provenance: { worktreeId: wt, revision: 3, commit: "abc123", dirty: false, runId, recordedAt },
  }) as ResultRecord;

const failureTexts = () => {
  const db = new DatabaseSync(storePaths(commonDir).database, { readOnly: true });
  const n = (db.prepare("SELECT COUNT(*) AS n FROM failure_texts").get() as { n: number }).n;
  db.close();
  return n;
};
const facts = (label: string) => {
  const texts = store.results.listForCheck(check, 99);
  const notes = [...readFlakyNotes(store).values()][0];
  const failRun = store.runs.get("run-fail");
  console.log(
    `${label}: results ${texts.map((r) => `${r.outcome}@${r.provenance.runId}`).join(", ")}; ` +
      `failures listed ${store.results.countFailures({ worktreeId: null, since: null })}; failure texts ${failureTexts()}; ` +
      `run-fail row ${failRun === null ? "gone" : "kept"}, log ${existsSync(join(runsDir, "run-fail")) ? "kept" : "gone"}; ` +
      `flaky note ${notes === undefined ? "none" : JSON.stringify(notes)}`,
  );
};
store.results.putMany([row("fail", "run-fail", NOW - 2 * 60_000 + 1_000)]);
facts("after the fail");
store.transaction(() => {
  const prior = store.results.byKey(KEY, 0);
  store.results.putMany([row("pass", "run-pass", NOW - 60_000 + 1_000)]);
  recordFlips(store, prior, [row("pass", "run-pass", NOW - 60_000 + 1_000)], NOW - 60_000 + 1_000);
});
facts("after the passing retry at the same key");
const first = store.prune({ now: NOW + HOUR, retentionDays: 7, maxSizeMb: null });
facts(`after the hourly prune (${JSON.stringify(first)})`);
const later = store.prune({ now: NOW + 8 * DAY, retentionDays: 7, maxSizeMb: null });
facts(`after a prune 8 days later (${JSON.stringify(later)})`);
store.close();
