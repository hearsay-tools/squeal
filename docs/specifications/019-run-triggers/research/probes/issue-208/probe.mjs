// Throwaway research probe. Run with pnpm exec tsx, from the repository root.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir, loadavg, cpus } from "node:os";
import { join } from "node:path";
import { differingPaths, testCounts } from "../../../../../../src/core/commit/compute.ts";
import { committedBlobs } from "../../../../../../src/core/commit/tree.ts";
import { storedBlobs } from "../../../../../../src/core/commit/stored.ts";
import { commitLine } from "../../../../../../src/core/commit/text.ts";
import { commitLines } from "../../../../../../src/core/status/commit-lines.ts";
import { checkIgnored } from "../../../../../../src/core/watcher/git.ts";
import { hashFile } from "../../../../../../src/core/hash/blob.ts";
import { reportHeadMove } from "../../../../../../src/core/scheduler/head-move.ts";
import { writeCommitReports, newestCommitReport } from "../../../../../../src/core/commit/store.ts";

const load = loadavg()[0];
console.log(JSON.stringify({ at: new Date().toISOString(), node: process.version, load, cpus: cpus().length }));
if (load > cpus().length) throw new Error("Host load exceeds CPU count; skipped");
const scratch = mkdtempSync(join(tmpdir(), "squeal-issue-208-"));
const root = join(scratch, "repo");
mkdirSync(root);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
const put = (path, bytes) => writeFileSync(join(root, path), bytes);
try {
  git("init", "-q");
  git("config", "user.name", "research fixture");
  git("config", "user.email", "research@example.invalid");
  mkdirSync(join(scratch, "dependency"));
  writeFileSync(join(scratch, "dependency", "value.mjs"), "export const value = 1;\n");
  symlinkSync("../dependency", join(root, "linked"));
  const files = Array.from({ length: 5 }, (_, n) => `case-${n + 1}.test.mjs`);
  for (const file of files) put(file, 'import { value } from "./linked/value.mjs";\n');
  put(".gitignore", "ignored.mjs\n");
  git("add", ".gitignore", "linked", ...files);
  git("commit", "-qm", "fixture");
  let commit = git("rev-parse", "HEAD");
  let committed = await committedBlobs(root, commit);
  const hashes = new Map(committed);
  hashes.set("linked/value.mjs", await hashFile(join(root, "linked/value.mjs"), "sha1"));
  let dependency = "linked/value.mjs";
  const view = {
    hashOf: path => hashes.get(path), paths: () => hashes.keys(),
    ignoredAmong: paths => checkIgnored(root, paths),
    storedBlobs: entries => storedBlobs(root, entries),
    closure: ref => [ref.path, dependency], isEnvironmentInput: () => false,
    testFiles: () => files.map(path => ({ testFile: { project: "probe", path }, key: "fixture-key", pending: null })),
    states: () => [],
  };
  async function report() {
    const { differing, unanswered } = await differingPaths(view, committed);
    const untracked = new Set([...differing].filter(path => !committed.has(path)));
    return { commit, revision: 1, at: Date.now(), tests: testCounts(view, { differing, unanswered, untracked }) };
  }
  const linked = await report();
  const clean = git("status", "--short", "--untracked-files=all");
  assert.equal(clean, "");
  assert.equal(linked.tests.untracked, 5);
  console.log(JSON.stringify({ scenario: "tracked-directory-symlink", gitStatus: clean, committedLinkedPaths: [...committed.keys()].filter(p => p.startsWith("linked")), report: linked.tests }));
  console.log(commitLines(commitLine(linked), true).join("\n"));

  async function pointTestsAt(path) {
    for (const file of files) put(file, `import { value } from "./${path}";\n`);
    git("add", ...files);
    git("commit", "-qm", `tests use ${path}`);
    commit = git("rev-parse", "HEAD");
    committed = await committedBlobs(root, commit);
    hashes.clear();
    for (const [path, hash] of committed) hashes.set(path, hash);
    dependency = path;
  }

  // A fresh computation excludes ordinary ignored dependencies.
  await pointTestsAt("ignored.mjs");
  put("ignored.mjs", "export const value = 1;\n");
  hashes.set("ignored.mjs", await hashFile(join(root, "ignored.mjs"), "sha1"));
  dependency = "ignored.mjs";
  const ignored = await report();
  assert.equal(ignored.tests.notDetermined, 0);
  console.log(JSON.stringify({ scenario: "ignored-control", gitStatus: git("status", "--short", "--untracked-files=all"), report: ignored.tests }));

  // An untracked dependency at report time can later be ignored without a HEAD move.
  await pointTestsAt("temporary.mjs");
  put("temporary.mjs", "export const value = 1;\n");
  hashes.set("temporary.mjs", await hashFile(join(root, "temporary.mjs"), "sha1"));
  dependency = "temporary.mjs";
  const before = await report();
  assert.equal(before.tests.untracked, 5);
  const rows = new Map();
  const meta = { get: key => rows.get(key) ?? null, set: (key, value) => rows.set(key, value) };
  writeCommitReports(meta, "fixture-worktree", commit, before);
  put(".git/info/exclude", "temporary.mjs\n");
  assert.equal(git("status", "--short", "--untracked-files=all"), "");
  // Real reportHeadMove takes its unchanged-HEAD/no-waiting early return.
  // No scheduler/runner is supplied; an attempted recomputation would throw.
  await reportHeadMove({ root, store: { meta }, worktreeId: "fixture-worktree" }, { revision: { number: 1, head: commit } });
  const kept = newestCommitReport(meta, "fixture-worktree");
  assert.equal(kept.tests.untracked, 5);
  const fresh = await report();
  assert.equal(fresh.tests.notDetermined, 0);
  console.log(JSON.stringify({ scenario: "stored-report-after-ignore", gitStatus: "", stored: kept.tests, freshlyComputed: fresh.tests }));
  console.log("All assertions passed; no daemon or test suite started.");
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
