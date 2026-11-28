import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createFsHasher } from "../../../../../../src/core/hash/hasher.js";
import { StatCache } from "../../../../../../src/core/hash/stat-cache.js";
import { installedDependencies } from "../../../../../../src/core/keys/environment.js";
import { refreshLevel } from "../../../../../../src/core/lint/pass/refresh.js";
import { reconcile, statCandidates } from "../../../../../../src/core/revision/reconcile.js";
import { FakeStore } from "../../../../../../test/hash/fakes.js";
import { writePnpmInstall } from "../../../../../../test/keys/install.js";

const load = loadavg();
assert.ok(load[0] < cpus().length, "skip live experiment above CPU-count load");
const root = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), "fixture-"));
const path = "node_modules/.pnpm/lock.yaml";
const full = join(root, path);
try {
  writePnpmInstall(root, { importers: { ".": { a: "1.0.0" } }, snapshots: { "a@1.0.0": {} } });
  const hasher = createFsHasher(root, "sha1");
  const stat = await hasher.stat(path);
  const hash = await hasher.hash(path);
  assert.ok(stat && hash);
  const cache = new StatCache([{ path, ...stat, hash }]);
  const store = new FakeStore();
  const initial = await installedDependencies(root, root);
  assert.ok(initial.graph, "fixture must use trusted per-package pnpm graph");
  assert.equal(initial.note, null);
  const results = [];
  const run = async (name: string, selectedCache = cache) => {
    const revision = await reconcile(
      { trigger: "watch", paths: await statCandidates([path], hasher) },
      selectedCache, hasher,
      { worktreeId: "probe", store, head: async () => ({ head: "probe", dirty: true }), ignored: async () => new Set([path]) },
    );
    const install = await installedDependencies(root, root);
    const changed = revision?.changes.map((change) => change.path) ?? [];
    const result = {
      name,
      revision: revision?.number ?? null,
      changes: revision?.changes ?? [],
      hashUnchanged: await hasher.hash(path) === hash,
      fingerprintUnchanged: install.fingerprint === initial.fingerprint,
      trustedGraph: install.graph !== null && install.note === null,
      lintRefresh: refreshLevel(changed, { tool: "eslint", toolVersion: "probe", providerVersion: 0, configFiles: [] }, []),
    };
    results.push(result);
    return result;
  };
  const before = statSync(full);
  utimesSync(full, before.atime, new Date(before.mtimeMs + 10_000));
  assert.notEqual(statSync(full).mtimeMs, before.mtimeMs);
  const touch = await run("mtime-only touch");
  assert.equal(touch.revision, null);
  assert.equal(touch.fingerprintUnchanged, true);
  assert.equal(touch.lintRefresh, "none");
  const original = readFileSync(full);
  writeFileSync(full, original);
  assert.equal((await run("identical-byte rewrite")).revision, null);
  writeFileSync(`${full}.replacement`, original);
  renameSync(`${full}.replacement`, full);
  assert.equal((await run("identical-byte atomic replacement")).revision, null);
  writeFileSync(full, `${original.toString()}\n# content-change control\n`);
  const control = await run("content-change control");
  assert.equal(control.revision, 1);
  assert.equal(control.fingerprintUnchanged, false);
  assert.equal(control.lintRefresh, "thread");
  const unseen = await run("unchanged file with empty stat cache", new StatCache());
  assert.equal(unseen.revision, 2);
  assert.equal(unseen.changes[0]?.oldHash, null);
  console.log(JSON.stringify({ node: process.version, cpus: cpus().length, load, results }, null, 2));
} finally {
  rmSync(root, { recursive: true, force: true });
}
