// Throwaway probe for research/issue-67.md. Synthetic store in os.tmpdir() only.
import { type CliIo, main } from "../../../../../../src/cli/main.js";
import { WorktreePaths } from "../../../../../../src/core/fs/worktree-paths.js";
import { describeFailure } from "../../../../../../src/core/state/fingerprint.js";
import type { ResultRecord } from "../../../../../../src/core/types/index.js";
import { toCheckError } from "../../../../../../src/runners/vitest/results.js";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeIdFor } from "../../../../../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/index.js";

// Inline copies of test/status/helpers.ts and test/store/helpers.ts, which register Vitest hooks.
const check = (testPath: string, fullName: string) => ({ kind: "test" as const, project: "", testPath, fullName });
function result(c: ReturnType<typeof check>, key: string, o: { outcome: "pass" | "fail"; worktreeId: string; recordedAt: number; runId?: string; errors?: ResultRecord["errors"] }): ResultRecord {
  return {
    check: c, key, outcome: o.outcome, durationMs: 12, location: null, fingerprint: null, summary: null,
    errors: o.errors ?? [],
    provenance: { worktreeId: o.worktreeId, revision: 4, commit: "abc123", dirty: true, runId: o.runId ?? "run-1", recordedAt: o.recordedAt },
  } as ResultRecord;
}
function fakeRepo() {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "squeal-issue67-")));
  const commonDir = join(main, ".git");
  mkdirSync(commonDir);
  writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
  return { main, commonDir, mainId: worktreeIdFor(main) };
}
function seedStore(repo: { commonDir: string }) {
  const store = openStore(repo.commonDir, { busyTimeoutMs: 10_000 });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  return store;
}

const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const MIN = 60_000;
const repo = fakeRepo();
const store = seedStore(repo);
store.worktrees.upsert({ id: repo.mainId, root: repo.main, commonDir: repo.commonDir, isMain: true, registeredAt: 1, daemon: null } as never);

// Q2: location of a helper-thrown failure.
const paths = new WorktreePaths(repo.main);
const TEST = "test/harness-autosave.test.ts";
const HELPER = "test/harness-parity.testkit.ts";
const stackText = [
  "AssertionError: expected 'idle' to be 'saved'",
  `    at waitFor (${repo.main}/${HELPER}:823:40)`,
  `    at ${repo.main}/${TEST}:84:15`,
  `    at ${repo.main}/node_modules/@vitest/runner/dist/index.js:155:11`,
].join("\n");
const error = toCheckError(
  {
    name: "AssertionError",
    message: "expected 'idle' to be 'saved'",
    stack: stackText,
    stacks: [
      { file: `${repo.main}/${HELPER}`, line: 823, column: 40, method: "waitFor" },
      { file: `${repo.main}/${TEST}`, line: 84, column: 15, method: "" },
      { file: `${repo.main}/node_modules/@vitest/runner/dist/index.js`, line: 155, column: 11, method: "" },
    ],
  } as never,
  paths,
);
const described = describeFailure([error], { path: TEST, line: 80, column: 3 });
console.log("== Q2 toCheckError.location:", JSON.stringify(error.location));
console.log("== Q2 fingerprint:", described.fingerprint);
console.log("== Q2 stored stack keeps test frame:", error.stack?.includes(`${TEST}:84:15`));

// Q1/Q3: 30 newer failures elsewhere; target check: 2 old failures, 22 newer passes.
const target = check(TEST, "autosave > saves after idle");
const records: ResultRecord[] = [];
const fail = (c: ReturnType<typeof check>, k: string, at: number): ResultRecord => ({
  ...result(c, k, { outcome: "fail", worktreeId: repo.mainId, recordedAt: at, runId: `run-${k}`, errors: [error] }),
  location: error.location,
  fingerprint: described.fingerprint,
  summary: described.summary,
});
records.push(fail(target, "t-fail-1", NOW - 300 * MIN), fail(target, "t-fail-2", NOW - 290 * MIN));
for (let i = 0; i < 22; i++) {
  records.push(result(target, `t-pass-${i}`, { outcome: "pass", worktreeId: repo.mainId, recordedAt: NOW - (200 - i) * MIN }));
}
for (let i = 0; i < 30; i++) {
  records.push(fail(check(`test/other-${i}.test.ts`, "other"), `o-${i}`, NOW - (60 - i) * MIN));
}
store.results.putMany(records);
store.close();

const run = (argv: string[]) => {
  let out = "";
  let err = "";
  const io: CliIo = { stdout: (t) => { out += t; }, stderr: (t) => { err += t; }, cwd: repo.main, now: () => NOW, env: {} };
  const code = main(argv, io);
  return { code, out, err };
};

const json = run(["failures", "--all-worktrees", "--json"]);
const report = JSON.parse(json.out);
console.log("== Q1 failures --json: exit", json.code, "total", report.total, "listed", report.failures.length, "limit", report.limit);
console.log("== Q1 target file in list:", report.failures.some((f: { check: { testPath: string } }) => f.check.testPath === TEST));
console.log("== Q1 keys per failure:", Object.keys(report.failures[0]).join(","));
const human = run(["failures", "--all-worktrees"]);
console.log("== Q1 human first lines:\n" + human.out.split("\n").slice(0, 4).join("\n"));
for (const argv of [["failures", TEST], ["failures", "--all-worktrees", "--limit", "100"], ["failures", "--check", "autosave"]]) {
  const r = run(argv);
  console.log(`== Q1 ${argv.join(" ")}: exit ${r.code}; ${r.err.split("\n")[0]}`);
}

const why = run(["why", "--json", `${TEST} > autosave > saves after idle`]);
console.log("== Q3 why --json exit", why.code, why.err.split("\n")[0]);
if (why.code === 0) {
  const w = JSON.parse(why.out);
  const outcomes = w.results.map((e: { result: { outcome: string } }) => e.result.outcome);
  console.log("== Q3 why results:", outcomes.length, "fail:", outcomes.filter((o: string) => o === "fail").length);
}
const whyHuman = run(["why", `${TEST} > autosave > saves after idle`]);
console.log("== Q3 why human exit", whyHuman.code, "has test frame 84:15:", whyHuman.out.includes(`${TEST}:84:15`), "has FAIL line:", /^\s+FAIL\s/m.test(whyHuman.out));
console.log("== Q3 why human head:\n" + whyHuman.out.split("\n").slice(0, 8).join("\n"));
console.log("== store dir:", repo.commonDir);
