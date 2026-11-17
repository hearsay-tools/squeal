// Throwaway research probe. Opens only repositories it creates, then removes them.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { codeGateCommand } from "../../../src/cli/code-gate.js";
import { isStoreOpenFailure, openStore } from "../../../src/core/store/open.js";
import { storePaths } from "../../../src/core/store/paths.js";
import type { ResultRecord } from "../../../src/core/types/store-records.js";

const load = loadavg()[0];
const cpus = availableParallelism();
console.log(JSON.stringify({ node: process.version, sqlite: process.versions.sqlite, load, cpus }));
if (load > cpus) {
  console.log("SKIP: one-minute load exceeds CPUs");
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), "squeal-issue-231-"));
const write = (root: string, file: string, text: string) => {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), text);
};
try {
  const root = join(scratch, "prune");
  const common = join(root, ".git");
  write(root, ".git/HEAD", "ref: refs/heads/main\n");
  const store = openStore(common);
  if (isStoreOpenFailure(store)) throw new Error(store.reason);
  try {
    store.worktrees.upsert({
      id: "main",
      root,
      commonDir: common,
      isMain: true,
      registeredAt: 1,
      daemon: null,
    });
    const day = 86400000;
    const now = 100 * day;
    const result = (
      key: string,
      age: number,
      worktreeId = "removed",
      name = key,
    ): ResultRecord => ({
      check: { kind: "test", project: "", testPath: "a.test.mjs", fullName: name },
      key,
      outcome: "pass",
      durationMs: 12,
      location: null,
      fingerprint: null,
      summary: null,
      errors: [],
      provenance: {
        worktreeId,
        revision: 1,
        commit: "abc",
        dirty: false,
        runId: `run-${key}`,
        recordedAt: now - age,
      },
    });
    store.results.putMany([
      result("expired", 8 * day),
      result("boundary", 7 * day),
      result("recent", 6 * day),
      result("live-key", 30 * day),
      result("main-newest", 30 * day, "main", "main-check"),
      result("main-older", 40 * day, "main", "main-check"),
    ]);
    store.testFileKeys.upsertMany([
      {
        worktreeId: "main",
        testFile: { project: "", path: "a.test.mjs" },
        key: "live-key",
        revision: 1,
        pending: null,
      },
    ]);
    const candidates = ["expired", "boundary", "recent", "live-key", "main-newest", "main-older"];
    const kept = () => candidates.filter((key) => store.results.byKey(key).length > 0);
    const first = store.prune({ now, retentionDays: 7, maxSizeMb: null });
    assert.deepEqual(kept(), ["boundary", "recent", "live-key", "main-newest"]);
    console.log(
      JSON.stringify({ prune: "at-cutoff", resultsRemoved: first.resultsRemoved, kept: kept() }),
    );
    const second = store.prune({ now: now + 1, retentionDays: 7, maxSizeMb: null });
    assert.deepEqual(kept(), ["recent", "live-key", "main-newest"]);
    console.log(
      JSON.stringify({
        prune: "one-ms-later",
        resultsRemoved: second.resultsRemoved,
        kept: kept(),
      }),
    );
    const before = store.results.byKey("recent")[0];
    store.results.putMany([
      {
        ...before,
        provenance: { ...before.provenance, runId: "replacement", recordedAt: now + 2 },
      },
    ]);
    assert.equal(store.results.byKey("recent").length, 1);
    assert.equal(store.results.byKey("recent")[0].provenance.runId, "replacement");
    console.log(JSON.stringify({ sameKeyRewrite: "one row; previous run provenance replaced" }));
  } finally {
    store.close();
  }

  const gateRoot = join(scratch, "gate");
  write(
    gateRoot,
    "package.json",
    JSON.stringify({ name: "issue-231-probe", type: "module", private: true }),
  );
  write(
    gateRoot,
    "squeal.config.json",
    JSON.stringify({
      complexity: { enabled: true },
      coverage: { enabled: true },
      nodeTest: [{ name: "tiny", include: ["test/a.test.mjs"] }],
    }),
  );
  write(gateRoot, "src/math.mjs", "export function double(x) {\n return x * 2;\n}\n");
  const test = (expected: number) =>
    `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { double } from '../src/math.mjs';\ntest('double', () => assert.equal(double(2), ${expected}));\n`;
  write(gateRoot, "test/a.test.mjs", test(4));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: gateRoot, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("add", ".");
  git(
    "-c",
    "user.name=Research Probe",
    "-c",
    "user.email=probe@example.invalid",
    "commit",
    "-qm",
    "fixture",
  );
  write(gateRoot, "src/math.mjs", "export function double(x) {\n return x + x;\n}\n");
  const gate = async (label: string) => {
    assert.ok(loadavg()[0] <= availableParallelism(), "load rose above CPUs; stop live probe");
    let stdout = "";
    let stderr = "";
    const started = performance.now();
    const code = await codeGateCommand(["--base", "main", "--json", "--timeout", "15"], {
      cwd: gateRoot,
      env: {},
      stdout: (s) => {
        stdout += s;
      },
      stderr: (s) => {
        stderr += s;
      },
    });
    assert.ok(stdout, `gate gave no report: ${stderr.replaceAll(scratch, "<scratch>")}`);
    const report = JSON.parse(stdout);
    const db = new DatabaseSync(storePaths(join(gateRoot, ".git")).database, { readOnly: true });
    try {
      const count = (table: string) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n;
      const rows = db
        .prepare("SELECT count(*) AS n FROM results r JOIN runs u ON u.id = r.run_id")
        .get()?.n;
      const summary = {
        label,
        code,
        verdict: report.verdict,
        wallMs: Math.round(performance.now() - started),
        budget: report.budget,
        runs: report.runs.map((r: Record<string, unknown>) => ({
          selected: r.selected,
          completed: r.completed,
          from: r.from,
          durationMs: r.durationMs,
        })),
        store: {
          checkpoints: count("checkpoints"),
          runs: count("runs"),
          results: count("results"),
          resultsJoinedToRuns: rows,
          runRows: db
            .prepare(
              "SELECT checkpoint_id, started_at IS NOT NULL AS has_start, ended_at IS NOT NULL AS has_end, end_state FROM runs",
            )
            .all(),
          gateResultIds: db
            .prepare("SELECT count(*) AS n FROM results WHERE run_id LIKE 'gate-%'")
            .get()?.n,
        },
      };
      assert.equal(summary.store.checkpoints, 0);
      console.log(JSON.stringify(summary));
      return summary;
    } finally {
      db.close();
    }
  };
  const first = await gate("first-pass");
  assert.equal(first.code, 0);
  assert.ok(Number(first.store.results) > 0);
  const reused = await gate("same-bytes-reuse");
  assert.equal(reused.code, 0);
  assert.equal(reused.runs[0].from["test/a.test.mjs"], "store");
  write(gateRoot, "test/a.test.mjs", test(5));
  const failed = await gate("failed-test");
  assert.equal(failed.code, 3);
  assert.ok(Number(failed.store.runs) > 0, "failed run should keep its log row");
  console.log("PASS: isolated prune, replacement, pass/reuse/failure gate probes");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
