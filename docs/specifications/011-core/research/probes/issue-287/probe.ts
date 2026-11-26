// Throwaway research fixture: no daemon or test runner is started.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { worktreeIdFor } from "../../../../../../src/core/fs/git-layout.js";
import { recordRefinedApplied } from "../../../../../../src/core/scheduler/refined.js";
import { readHeader } from "../../../../../../src/core/state/header.js";
import { openStore } from "../../../../../../src/core/store/open.js";

const load = readFileSync("/proc/loadavg", "utf8").trim();
console.log(JSON.stringify({ load, cpus: cpus().length, node: process.version }));
if (Number(load.split(" ")[0]) > cpus().length) {
  console.log("SKIPPED: one-minute load exceeds CPU count");
  process.exit(0);
}
const cli = join(homedir(), ".codex/plugins/data/squeal-hearsay/versions/0.1.641/dist/cli/squeal.mjs");
const root = mkdtempSync(join(tmpdir(), "squeal-issue-287-"));
const commonDir = join(root, ".git");
mkdirSync(commonDir);
writeFileSync(join(commonDir, "HEAD"), "ref: refs/heads/main\n");
writeFileSync(join(root, "squeal.config.json"), JSON.stringify({
  checks: [{ name: "browser", runner: "vitest", tests: ["test/browser/**"], at: "manual" }],
  slow: { include: ["test/slow/**"] },
  lint: { enabled: true },
}));
function cliRead(args: string[]) {
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, ...args], {
    cwd: root, encoding: "utf8", timeout: 10_000,
  }).replaceAll(homedir(), "~");
}
let store: ReturnType<typeof openStore> | undefined;
try {
  console.log(`VERSION ${cliRead(["--version"]).trim()}`);
  const before = cliRead(["checks"]);
  console.log(`CASE no-store\n${before}`);
  assert.match(before, /^tests$/m);
  const opened = openStore(commonDir);
  store = opened;
  if ("reason" in opened) throw new Error(JSON.stringify(opened));
  const worktreeId = worktreeIdFor(root);
  opened.worktrees.upsert({ id: worktreeId, root, commonDir, isMain: true,
    registeredAt: Date.now(), daemon: null });
  function capture(label: string) {
    const header = readHeader(opened as Exclude<typeof opened, { reason: string }>, worktreeId);
    const output = cliRead(["checks"]);
    console.log(`CASE ${label} ${JSON.stringify({ revision: header.revision,
      testFilesListed: header.testFilesListed, refinedRevision: header.refinedRevision,
      runnerPartPending: header.runnerPartPending })}\n${output}`);
    return output;
  }
  const initial = capture("registered-empty");
  assert.doesNotMatch(initial, /^tests$/m);
  assert.match(initial, /Test files now: 0/);
  for (let n = 0; n < 2; n++) opened.revisions.append({ worktreeId,
    createdAt: Date.now(), head: null, dirty: true, trigger: "watch", changes: [] });
  recordRefinedApplied(opened, worktreeId, 0);
  const pending = capture("revision-2-unlisted");
  assert.doesNotMatch(pending, /^tests$/m);
  assert.doesNotMatch(pending, /discovery|not listed|incomplete|starting/);
  opened.testFileKeys.upsertMany([{ worktreeId,
    testFile: { project: "", path: "test/unit/a.test.ts" },
    key: "synthetic-key", revision: 2, pending: "queued" }]);
  recordRefinedApplied(opened, worktreeId, 2);
  const listed = capture("listed-one-unit-file");
  assert.match(listed, /^tests$/m);
  assert.match(listed, /Test files now: 1/);
  console.log("CONFIRMED: pending inventory hides tests; adding its first listed file restores it.");
} finally {
  if (store !== undefined && !("reason" in store)) store.close();
  rmSync(root, { recursive: true, force: true });
}
