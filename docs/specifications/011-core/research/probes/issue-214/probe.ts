// Throwaway research probe. See README.md for scope and synthetic seams.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { codeGateCommand } from "../../../src/cli/code-gate.js";
import { storedFiles } from "../../../src/cli/code-gate-stored.js";
import { retryCommand } from "../../../src/cli/retry.js";
import { worktreeIdFor } from "../../../src/core/fs/git-layout.js";
import { askRetry, readRetries } from "../../../src/core/retry/records.js";
import { loadRetryWhenText, retryStartText } from "../../../src/core/retry/text.js";
import { retryWaitOf } from "../../../src/core/retry/waits.js";
import type { SchedulerContext } from "../../../src/core/scheduler/context.js";
import { newFileState } from "../../../src/core/scheduler/files.js";
import type { Ledger } from "../../../src/core/scheduler/ledger.js";
import { Priority, RunQueue } from "../../../src/core/scheduler/queue.js";
import { takeRetries } from "../../../src/core/scheduler/retries.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";

const sample = {
  at: new Date().toISOString(),
  cpus: availableParallelism(),
  load: loadavg(),
  node: process.version,
};
console.log(JSON.stringify({ host: sample }));
if ((sample.load[0] ?? 0) > sample.cpus) throw new Error("Load exceeds CPU count: skip probes");
const scratch = mkdtempSync(join(tmpdir(), "squeal-issue-214-"));
function storeAt(path: string) {
  const store = openStore(path);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  return store;
}

try {
  // Real retry intake and queue, with a controlled clock and no runner.
  const store = storeAt(join(scratch, "scheduler"));
  try {
    let now = 1_000;
    const ref = { project: "", path: "test/retry.test.ts" };
    const file = newFileState(ref);
    Object.assign(file, { key: "key", resultKey: "key", failing: true });
    const queue = new RunQueue();
    const notes: string[] = [];
    const context = {
      store,
      worktreeId: "probe",
      now: () => now,
      hostLoad: () => ({ oneMinute: 170, cpus: 24 }),
      note: (text: string) => notes.push(text),
    } as unknown as SchedulerContext;
    // These are the only Ledger operations intake needs. Selection is the real RunQueue.
    const ledger = {
      files: new Map([[file.id, file]]),
      file: () => file,
      enqueue: (_file: unknown, priority: Priority, forced: boolean) =>
        queue.add(ref, priority, forced),
      dequeue: () => false,
    } as unknown as Ledger;
    askRetry(store, {
      testFile: ref,
      key: "key",
      session: "load",
      reason: "load",
      at: now,
      worktreeId: "probe",
    });
    now += 600_000; // No daemon look yet: request age alone grants no eligibility.
    assert.equal(
      takeRetries(context, ledger, () => {}),
      false,
    );
    assert.equal(readRetries(store)[0]?.gateClosedAt, now);
    now += 599_999;
    assert.equal(
      takeRetries(context, ledger, () => {}),
      false,
    );
    now += 1;
    assert.equal(
      takeRetries(context, ledger, () => {}),
      true,
    );
    const edit = { project: "", path: "test/edit.test.ts" };
    queue.add(edit, Priority.edited, false, true);
    assert.deepEqual(queue.ordered(), [edit, ref]);
    const wait = retryWaitOf(ref, { isSlow: () => false, activity: null, runs: [] });
    assert.equal(wait.kind, "unknown");
    console.log(
      JSON.stringify({
        loadRetry: {
          requestAgeMs: now - 1_000,
          gateAgeMs: 600_000,
          queued: queue.ordered().map((f) => f.path),
          runningKey: file.runningKey,
          pending: readRetries(store)[0]?.end === null,
          wait,
          notes,
          receipt: loadRetryWhenText({ oneMinute: 170, cpus: 24 }),
          status: retryStartText(wait),
        },
      }),
    );
    // A new key with an explicit environment retry queues without a load wait.
    Object.assign(file, { key: "environment-key", resultKey: "environment-key", retryKey: null });
    askRetry(store, {
      testFile: ref,
      key: "environment-key",
      session: "environment",
      reason: "environment",
      at: now,
      worktreeId: "probe",
    });
    assert.equal(
      takeRetries(context, ledger, () => {}),
      true,
    );
    assert.equal(file.retryKey, "environment-key");
    assert.equal(file.runningKey, null);
    console.log(
      JSON.stringify({
        environmentRetry: {
          queued: true,
          started: false,
          gateClosedAt: readRetries(store)[1]?.gateClosedAt ?? null,
        },
      }),
    );
  } finally {
    store.close();
  }

  // One real node:test file and the real gate CLI handler, in an isolated git repo.
  const root = join(scratch, "gate");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"));
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "issue-214-probe", type: "module", private: true }),
  );
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({
      coverage: { enabled: true },
      nodeTest: [{ name: "unit", include: ["test/**/*.test.ts"] }],
    }),
  );
  writeFileSync(join(root, "src/math.ts"), "export function double(x: number) { return x * 2; }\n");
  writeFileSync(
    join(root, "test/math.test.ts"),
    'import { test } from "node:test";\nimport { strictEqual } from "node:assert";\nimport { double } from "../src/math.ts";\ntest("synthetic failure", () => strictEqual(double(2), 99));\n',
  );
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "base");
  writeFileSync(join(root, "src/math.ts"), "export function double(x: number) { return 2 * x; }\n");
  git("add", "src/math.ts");
  git("-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "change");
  const base = git("rev-parse", "HEAD^").trim();
  const gate = async (load = 0) => {
    let stdout = "",
      stderr = "";
    const code = await codeGateCommand(["--base", base, "--json"], {
      cwd: root,
      env: {},
      hostLoad: () => ({ oneMinute: load, cpus: 24 }),
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    });
    if (!stdout.trim()) throw new Error(stderr);
    return { code, report: JSON.parse(stdout), stderr };
  };
  const first = await gate();
  assert.equal(first.code, 3);
  const ref = { project: "unit", path: "test/math.test.ts" };
  const stored = storedFiles(root, {}, (text) => console.log(JSON.stringify({ lookupNote: text })));
  assert.ok(stored);
  const key = (await stored.keys([ref])).get(ref);
  await stored.close();
  assert.ok(key);
  const mainStore = storeAt(join(root, ".git"));
  try {
    const before = mainStore.results.byKey(key, 0);
    assert.ok(
      before.some((r) => r.outcome === "fail"),
      "first gate must keep failed evidence",
    );
    askRetry(mainStore, {
      testFile: ref,
      key,
      session: "pending-load",
      reason: "load",
      at: Date.now(),
      worktreeId: worktreeIdFor(root),
    });
    const second = await gate(170);
    assert.equal(second.code, 3);
    assert.ok(second.report.functions.some((f: { gap: string }) => f.gap === "test-failed"));
    assert.equal(second.report.runs[0].from[ref.path], "store");
    assert.equal(readRetries(mainStore)[0]?.end, null);
    assert.deepEqual(mainStore.results.byKey(key, 0), before);
    console.log(
      JSON.stringify({
        gate: {
          first: { code: first.code, runs: first.report.runs },
          pendingRetry: true,
          syntheticGateLoad: 170,
          second: {
            code: second.code,
            verdict: second.report.verdict,
            runs: second.report.runs,
            functions: second.report.functions.map(
              (f: { qualifiedName: string; state: string; gap: string }) => ({
                name: f.qualifiedName,
                state: f.state,
                gap: f.gap,
              }),
            ),
            stderr: second.stderr,
          },
          storedResultsUnchanged: true,
        },
      }),
    );
    askRetry(mainStore, {
      testFile: ref,
      key,
      session: "pending-environment",
      reason: "environment",
      at: Date.now(),
      worktreeId: worktreeIdFor(root),
    });
    const third = await gate(170);
    assert.equal(third.code, 3);
    assert.equal(third.report.runs[0].from[ref.path], "store");
    assert.equal(readRetries(mainStore).filter((r) => r.end === null).length, 2);
    console.log(
      JSON.stringify({
        gateWithBothReasonsPending: {
          code: third.code,
          verdict: third.report.verdict,
          from: third.report.runs[0].from,
          retryCount: 2,
        },
      }),
    );
  } finally {
    mainStore.close();
  }
  let usage = "";
  const usageCode = await retryCommand(["test/math.test.ts", "--reason", "load", "--wait", "1"], {
    cwd: root,
    stdout: () => {},
    stderr: (s) => {
      usage += s;
    },
  });
  assert.equal(usageCode, 2);
  assert.match(usage, /unknown option "--wait"/);
  console.log(JSON.stringify({ retryWait: { code: usageCode, stderr: usage } }));
  console.log(
    "PASS: controlled retry eligibility, normal queue order, unknown blocker, stored failed gate evidence during pending retry, and unsupported retry --wait",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
