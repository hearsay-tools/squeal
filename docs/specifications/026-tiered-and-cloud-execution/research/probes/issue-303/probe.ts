// Throwaway research probe. Real source + Git; SSH is a local shell shim.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, loadavg, tmpdir } from "node:os";
import { join } from "node:path";
import { gitEntryByKind } from "../../../../../../src/core/keys/observed.js";
import { BOOTSTRAP_DEADLINES, ensureGitTree, localGitState } from "../../../../../../src/core/runner-host/remote/providers/agent37/bootstrap.js";
import { gitKeeper } from "../../../../../../src/core/runner-host/remote/providers/agent37/machine.js";
import { treeEntries, writesFor } from "../../../../../../src/core/runner-host/remote/tree.js";
import { createTreeHost } from "../../../../../../src/core/runner-host/remote/tree-host.js";
import type { AbsolutePath } from "../../../../../../src/core/types/common.js";
import { fakeSshAt } from "../../../../../../test/runner-host/remote/providers/agent37-api-mock.js";

const cpus = availableParallelism();
const load = loadavg();
console.log(JSON.stringify({ phase: "environment", node: process.version, git: execFileSync("git", ["--version"]).toString().trim(), cpus, load }));
if (load[0] > cpus) throw new Error("Probe skipped: load1 exceeds CPU count");
const dir = mkdtempSync(join(tmpdir(), "squeal-issue-303-"));
try {
  const root = join(dir, "local") as AbsolutePath;
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/old.ts"), "export const value = 1;\n");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, "-c", "user.name=probe", "-c", "user.email=probe@example.invalid", ...args]).toString().trim();
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "initial");
  const ssh = fakeSshAt(dir);
  const target = { destination: "fixture", ssh: join(ssh.bin, "ssh") };
  const tree = "cache/squeal/trees/probe";
  const remote = join(ssh.home, tree, "root");
  const listing = (at: string) => execFileSync("git", ["-C", at, "ls-files", "--cached", "--others", "--exclude-standard"]).toString().trim().split("\n");
  const readListed = (at: string) => {
    try { for (const path of listing(at)) readFileSync(join(at, path)); return "PASS"; }
    catch (error) { return (error as NodeJS.ErrnoException).code; }
  };
  const initial = await ensureGitTree(target, tree, root, BOOTSTRAP_DEADLINES);
  assert.notEqual(initial.kind, "none");
  if (initial.kind === "none") throw new Error(initial.why);
  const host = createTreeHost(remote, () => {});
  const syncBytes = async () => {
    const entries = await treeEntries(root);
    const { missing } = await host.tree(entries);
    for (const write of await writesFor(root, missing, new Set(entries.map((e) => e.path)))) await host.write(write);
    return entries;
  };
  await syncBytes();
  const keeper = gitKeeper({ tree, root, deadlines: BOOTSTRAP_DEADLINES, log: () => {} }, initial.state);
  const stateBefore = await localGitState(root);
  git("mv", "src/old.ts", "src/new.ts");
  const afterRenameEntries = await syncBytes();
  const callsBefore = ssh.argv().length;
  const reportedCurrent = await keeper.sync(target);
  const keeperSshCalls = ssh.argv().length - callsBefore;
  const directEnsure = await ensureGitTree(target, tree, root, BOOTSTRAP_DEADLINES);
  const renamed = { phase: "staged-rename", gitStateUnchanged: stateBefore?.key === (await localGitState(root))?.key, reportedCurrent, keeperSshCalls, directEnsure: directEnsure.kind, local: listing(root), remote: listing(remote), remoteOldExists: existsSync(join(remote, "src/old.ts")), remoteNewExists: existsSync(join(remote, "src/new.ts")), localRead: readListed(root), remoteRead: readListed(remote) };
  console.log(JSON.stringify(renamed));
  assert.equal(renamed.gitStateUnchanged, true);
  assert.equal(reportedCurrent, true);
  assert.equal(keeperSshCalls, 0);
  assert.equal(directEnsure.kind, "present");
  assert.equal(renamed.remoteRead, "ENOENT");
  assert.equal(renamed.localRead, "PASS");
  const gitKindBefore = gitEntryByKind(root, () => "tracked")(".git");
  git("commit", "-qm", "rename");
  const currentBeforeRefresh = await keeper.sync(null);
  const readBeforeRefresh = readListed(remote);
  const currentAfterRefresh = await keeper.sync(target);
  const committed = { phase: "committed-rename", treeBytesUnchanged: JSON.stringify(afterRenameEntries) === JSON.stringify(await treeEntries(root)), gitKindHashUnchanged: gitKindBefore === gitEntryByKind(root, () => "tracked")(".git"), currentBeforeRefresh, readBeforeRefresh, currentAfterRefresh, local: listing(root), remote: listing(remote), remoteRead: readListed(remote) };
  console.log(JSON.stringify(committed));
  assert.equal(committed.treeBytesUnchanged, true);
  assert.equal(committed.gitKindHashUnchanged, true);
  assert.equal(currentBeforeRefresh, false);
  assert.equal(readBeforeRefresh, "ENOENT");
  assert.equal(currentAfterRefresh, true);
  assert.equal(committed.remoteRead, "PASS");
  assert.deepEqual(committed.remote, committed.local);
  console.log("PASS: staged-index mismatch reproduced; explicit post-commit Git refresh repaired the fixture.");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
