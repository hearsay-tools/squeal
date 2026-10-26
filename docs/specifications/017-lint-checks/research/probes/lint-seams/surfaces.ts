/*
 * Throwaway probe for research 017-02 (lint-seams.md). Not product code, not a test.
 *
 * It asks Squeal's own modules, at this commit, what happens when a per-file
 * lint check is put on the test path, and what the code path's tables do with
 * a kind or measure they do not know. Everything runs in a scratch directory
 * under $TMPDIR; no daemon, no socket, no live store. Run with:
 *
 *   HOME=$T XDG_RUNTIME_DIR=$T XDG_CONFIG_HOME=$T TMPDIR=$T npx tsx surfaces.ts
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { squealEvidence } from "../../../../../../evals/lib/index.mjs";
import { includedSet } from "../../../../../../src/core/code/pass/included.js";
import { mainStoreSource } from "../../../../../../src/core/code/pass/source.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../../../../src/core/code/store/index.js";
import { createDelivery, formatDelta } from "../../../../../../src/core/delivery/index.js";
import { createStateSink, describeFailure } from "../../../../../../src/core/state/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";
import { knownFailuresLine } from "../../../../../../src/harness/shared/text.js";
import {
  bootstrappedMetaKey,
  type CheckError,
  type CheckId,
  DEFAULT_POLICY,
  type ResultRecord,
  type StatusBuilder,
} from "../../../../../../src/core/types/index.js";

const WT = "wt-a";
const out = (title: string, value: unknown) =>
  console.log(`\n## ${title}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}`);

function commonDir(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "lint-seams-")), ".git");
  mkdirSync(dir);
  writeFileSync(join(dir, "HEAD"), "ref: refs/heads/main\n");
  return dir;
}

const status: StatusBuilder = {
  build: () => ({ schemaVersion: 1, available: false, reason: "timeout", message: "fake" }),
};

/** One ESLint message as a runner adapter would report it: an error with a location. */
const finding = (rule: string, message: string, line: number): CheckError => ({
  name: rule,
  message,
  stack: null,
  location: { path: "src/a.ts", line, column: 7 },
  diff: null,
});

function result(check: CheckId, errors: readonly CheckError[], key: string, revision: number): ResultRecord {
  const outcome = errors.length === 0 ? "pass" : "fail";
  const location = { path: check.testPath, line: 1, column: 1 };
  const described = outcome === "fail" ? describeFailure(errors, location) : null;
  return {
    check,
    key,
    outcome,
    durationMs: 40,
    location,
    fingerprint: described?.fingerprint ?? null,
    summary: described?.summary ?? null,
    errors,
    provenance: { worktreeId: WT, revision, commit: "c0ffee", dirty: false, runId: `r${revision}`, recordedAt: revision * 1000 },
  };
}

// ---------------------------------------------------------------------------
// P1. A lint file check on the test path: the real sink, delivery and formatter.
// ---------------------------------------------------------------------------
{
  const dir = commonDir();
  const store = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  let clock = 10_000;
  store.worktrees.upsert({ id: WT, root: "/repo/wt-a", commonDir: dir, isMain: true, registeredAt: 1, daemon: null });
  store.worktrees.setDaemon(WT, {
    socketPath: "/run/x.sock", startedAt: 1, heartbeatAt: Date.now(), heartbeatIntervalMs: 3_600_000,
    squealVersion: "0.0.0-probe", token: "live",
  });
  store.meta.set(bootstrappedMetaKey(WT), "1");
  // The lint "project" lists src/a.ts as one of its files, as a runner lists a test file.
  const ref = { project: "eslint", path: "src/a.ts" };
  const lint: CheckId = { kind: "file", project: "eslint", testPath: "src/a.ts" };
  const setKey = (key: string, revision: number) =>
    store.testFileKeys.upsertMany([{ worktreeId: WT, testFile: ref, key, revision, pending: null }]);
  const sink = createStateSink(store, { now: () => clock });
  const delivery = () => createDelivery(store, { status, now: () => clock });
  const consumer = { worktreeId: WT, sessionId: "s1", agentId: "main" };

  setKey("k1", 1);
  sink.applyResults(WT, 1, [result(lint, [], "k1", 1)], { checkpointId: null });
  clock += 1000;
  await delivery().register(consumer);

  const told = async (title: string) => {
    clock += 1000;
    const delta = await delivery().onToolBoundary(consumer);
    const text = delta === null ? "(nothing delivered)" : formatDelta(delta);
    out(`${title}: delivery`, text);
    if (delta !== null) out(`${title}: what evals/lib/squeal-text.mjs reads`, squealEvidence(text, "push"));
    const fails = store.knownStates.list(WT).filter((s) => s.outcome === "fail");
    out(`${title}: known states that fail`, fails.map((s) => ({ check: s.check, fingerprint: s.fingerprint })));
  };

  // s1: two findings appear.
  setKey("k2", 2);
  sink.applyResults(WT, 2, [result(lint, [
    finding("no-unused-vars", "'count' is assigned a value but never used.", 3),
    finding("no-console", "Unexpected console statement.", 7),
  ], "k2", 2)], { checkpointId: null });
  await told("s1 two findings appear (PASS -> FAIL)");

  // s2: a line inserted above both; the same two findings, each one line lower.
  setKey("k3", 3);
  sink.applyResults(WT, 3, [result(lint, [
    finding("no-unused-vars", "'count' is assigned a value but never used.", 4),
    finding("no-console", "Unexpected console statement.", 8),
  ], "k3", 3)], { checkpointId: null });
  await told("s2 a line inserted above, same findings");

  // s3: the second finding fixed, the first stays where it is.
  setKey("k4", 4);
  sink.applyResults(WT, 4, [result(lint, [
    finding("no-unused-vars", "'count' is assigned a value but never used.", 4),
  ], "k4", 4)], { checkpointId: null });
  await told("s3 the second finding fixed");

  out("P1a: Stop's and status's known-failures line", knownFailuresLine(store.knownStates.list(WT).filter((s) => s.outcome === "fail")));

  // The code pass reads the runners' listed files as test files and never counts them.
  const source = mainStoreSource(store, WT, () => []);
  const testFiles = source.testFiles();
  const included = includedSet(DEFAULT_POLICY.complexity, testFiles, []);
  out("P1b: the code pass's test files and whether src/a.ts is counted", {
    testFiles,
    "includedSet('src/a.ts')": included("src/a.ts"),
    "includedSet('src/b.ts')": included("src/b.ts"),
  });

  // P2. A check kind the main store's codec does not know.
  store.close();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "squeal", "store.sqlite"));
  db.prepare("UPDATE checks SET kind = 'lint'").run();
  db.close();
  const again = openStore(dir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(again)) throw new Error(JSON.stringify(again));
  try {
    again.knownStates.list(WT);
    out("P2: main store known states with checks.kind = 'lint'", "read without error");
  } catch (error) {
    out("P2: main store known states with checks.kind = 'lint'", `throws: ${String(error)}`);
  }
  again.close();
}

// ---------------------------------------------------------------------------
// P3. A measure the code store's codec does not know.
// ---------------------------------------------------------------------------
{
  const dir = commonDir();
  const code = openCodeStore(dir, { complexity: { ...DEFAULT_POLICY.complexity, enabled: true } });
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  code.close();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "squeal", "code.sqlite"));
  db.exec("INSERT INTO checks (id, path, qualified_name, occurrence) VALUES (1, 'src/a.ts', '', 0)");
  db.exec(
    `INSERT INTO states (worktree_id, check_id, measure, outcome, value, threshold, counted_at, blob, changed_at)
     VALUES ('${WT}', 1, 'lint', 'fail', NULL, NULL, 1, 'b1', 1)`,
  );
  db.close();
  const reopened = openCodeStore(dir, { complexity: { ...DEFAULT_POLICY.complexity, enabled: true } }, { create: false });
  if (isCodeStoreOpenFailure(reopened)) throw new Error(JSON.stringify(reopened));
  try {
    reopened.states.list(WT);
    out("P3: code store states with measure = 'lint'", "read without error");
  } catch (error) {
    out("P3: code store states with measure = 'lint'", `throws: ${String(error)}`);
  }
  try {
    reopened.states.list(WT, { measure: "complexity" });
    out("P3b: the same, filtered to measure = 'complexity'", "read without error");
  } catch (error) {
    out("P3b: the same, filtered to measure = 'complexity'", `throws: ${String(error)}`);
  }
  // Off: the code store is not opened at all.
  out("P3c: openCodeStore with complexity.enabled false", openCodeStore(dir, { complexity: { ...DEFAULT_POLICY.complexity, enabled: false } }));
  reopened.close();
}

// ---------------------------------------------------------------------------
// P4. The code-line form: one space after FAIL, read by no parser rule.
// ---------------------------------------------------------------------------
{
  const test = [
    "SQUEAL · 1 check changed at revision 5",
    "",
    "FAIL  src/b.test.ts > adds",
    "      PASS -> FAIL at revision 5",
    "      expected 1 to be 2",
  ];
  const lintLine = "FAIL lint: src/a.ts has 2 ESLint findings: +1 no-console, 1 no-unused-vars (ESLint 9.39.5)";
  out("P4: the evals parser with and without a code-form lint line", {
    without: squealEvidence(test.join("\n"), "push")?.checks,
    with: squealEvidence([...test, lintLine].join("\n"), "push")?.checks,
  });
}
