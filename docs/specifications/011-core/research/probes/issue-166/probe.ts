// Throwaway research probe. It writes only inside its own mkdtemp directory.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { createFsHasher } from "../../../../../../src/core/hash/hasher.js";
import { assembleClosure } from "../../../../../../src/core/keys/closure.js";
import { ObservedSets, observedMetaKey } from "../../../../../../src/core/keys/observed.js";
import { WorktreeKeys } from "../../../../../../src/core/scheduler/keying.js";
import { buildSnapshot } from "../../../../../../src/core/status/snapshot.js";
import { isStoreOpenFailure, openStore } from "../../../../../../src/core/store/open.js";
import { DEFAULT_POLICY } from "../../../../../../src/core/types/policy.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const version = JSON.parse(readFileSync(join(repository, "package.json"), "utf8")).version;
const emit = (value: unknown) => console.log(JSON.stringify(value));
emit({
  at: new Date().toISOString(),
  version,
  node: process.version,
  load: loadavg(),
  cpus: cpus().length,
});
if (loadavg()[0] > cpus().length) {
  emit({ verdict: "not reproduced, because one-minute load exceeds CPU count" });
  process.exit(0);
}
const scratch = mkdtempSync(join(tmpdir(), "sq-issue-166-"));
const root = join(scratch, "repo");
const common = join(root, ".git");
const runtime = join(scratch, "runtime");
const cli = join(repository, "plugins/claude-code/dist/cli/squeal.mjs");
const bad = String.raw`\home\agent\AppData\Local\Hearsay Squawk\cache`;
const ref = { project: "server", path: "read-process.test.mjs" };
const closure = { testFile: ref, paths: [ref.path] };
const open = () => {
  const store = openStore(common, { checkIntegrity: "quick" });
  if (isStoreOpenFailure(store)) throw new Error(JSON.stringify(store));
  return store;
};
const git = (args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
const env = {
  PATH: process.env.PATH,
  XDG_RUNTIME_DIR: runtime,
  XDG_CONFIG_HOME: join(scratch, "config"),
};
async function daemonAttempt(label: string, target: string, shouldFail: boolean) {
  const load = loadavg()[0];
  if (load > cpus().length) {
    emit({ label, skipped: "one-minute load exceeds CPU count", load });
    return;
  }
  const child = spawn(process.execPath, [cli, "daemon", target], {
    cwd: scratch,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exited = new Promise((resolveExit) =>
    child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15_000);
  let snapshot: ReturnType<typeof buildSnapshot> | undefined;
  try {
    if (shouldFail) {
      const exit = await exited;
      const store = open();
      try {
        snapshot = buildSnapshot(store, target, Date.now());
      } finally {
        store.close();
      }
      emit({
        label,
        load,
        exit,
        testFilesListed: snapshot.testFilesListed,
        daemon: snapshot.daemon,
        notes: snapshot.daemonNotes,
        stdout,
        stderr,
      });
      assert.equal((exit as { code: number }).code, 1);
      assert.equal(snapshot.testFilesListed, false);
      assert.match(JSON.stringify(snapshot.daemonNotes), /expected a worktree-relative path/);
    } else {
      for (let i = 0; i < 80; i++) {
        const store = open();
        try {
          snapshot = buildSnapshot(store, target, Date.now());
        } finally {
          store.close();
        }
        if (snapshot.testFilesListed) break;
        await sleep(100);
      }
      emit({ label, load, testFilesListed: snapshot?.testFilesListed, daemon: snapshot?.daemon });
      assert.equal(snapshot?.testFilesListed, true);
    }
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
    clearTimeout(timeout);
  }
}
try {
  mkdirSync(root);
  mkdirSync(runtime, { mode: 0o700 });
  writeFileSync(join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(join(root, ref.path), 'import { test } from "node:test"; test("ok", () => {});\n');
  writeFileSync(
    join(root, "squeal.config.json"),
    JSON.stringify({
      nodeTest: [{ name: "server", include: ["*.test.mjs"], argv: [], env: {} }],
      baseline: { onStart: "lookup-only" },
      complexity: { enabled: false },
      coverage: { enabled: false },
    }),
  );
  git(["init", "-q"]);
  git(["add", "package.json", ref.path, "squeal.config.json"]);
  git([
    "-c",
    "user.name=Research probe",
    "-c",
    "user.email=probe@example.invalid",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-qm",
    "fixture",
  ]);
  let store = open();
  new ObservedSets(store).add(ref, [bad]);
  emit({ label: "persisted", meta: store.meta.get(observedMetaKey(ref.project)) });
  store.close();
  store = open();
  try {
    const observed = new ObservedSets(store).of(ref);
    assert.deepEqual(observed, [bad]);
    assert.throws(
      () => assembleClosure(closure, [], observed),
      /expected a worktree-relative path/,
    );
    const keys = new WorktreeKeys({
      root,
      worktreeId: "probe",
      store,
      hasher: createFsHasher(root, "sha1"),
      objectFormat: "sha1",
      policy: DEFAULT_POLICY,
      squealVersion: version,
      env: {},
      onExtraFiles: () => {},
    });
    let message = "";
    try {
      keys.setClosure(closure);
    } catch (error) {
      message = String(error);
    }
    assert.match(message, /expected a worktree-relative path/);
    emit({ label: "reopened-core", observed, message });
  } finally {
    store.close();
  }
  await daemonAttempt("first-start", root, true);
  await daemonAttempt("restart", root, true);
  const sibling = join(scratch, "sibling");
  git(["worktree", "add", "--detach", sibling, "HEAD"]);
  await daemonAttempt("fresh-scratch-worktree", sibling, true);
  store = open();
  try {
    assert.deepEqual(new ObservedSets(store).of(ref), [bad]);
    // Clean-store control in this probe's own disposable store only.
    store.transaction(() => store.meta.set(observedMetaKey(ref.project), "{}"));
  } finally {
    store.close();
  }
  await daemonAttempt("clean-store-control", root, false);
  emit({
    verdict: "all executed assertions passed",
    at: new Date().toISOString(),
    load: loadavg(),
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
