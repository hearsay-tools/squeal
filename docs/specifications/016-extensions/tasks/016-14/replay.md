# 016-14: replay of goal 3's three past defects

Worker 016-14, 2026-10-25. Spec 016 goal 3: replaying three past defects on a scratch branch makes the kit fail each one. Result: the kit fails all three, each in the scenario written for it.

## Method

- Base: `08c6b9dfc`, the commit that adds K4 to K9 to the kit (row 016-14).
- One scratch branch per defect, each from the base, in a scratch worktree outside the repository's worktrees. Its `node_modules` is a link to this worktree's. The branches were never pushed and were deleted after the runs. The diffs below reintroduce each defect again.
- Each defect is reintroduced in today's code, at the place its fix landed. The rest of the tree is unchanged.
- Each run is the defect's runner's kit file alone, `npx vitest run test/kit/<runner>.test.ts --maxWorkers=1`. No Squeal daemon validates the scratch worktree, so the runs are direct.
- Control: the three kit files at the base, in the same scratch worktree (section "Control").

## 1. Row 007-29: a shared bytecode cache

The defect: every pytest run used one `PYTHONPYCACHEPREFIX`, kept across runs. CPython accepts a `.pyc` whose source has the same whole-second mtime and size, so a same-size edit in the same second ran the old code. Fix: `e2a09088f`, a prefix of each run's own.

Scratch commit `4479c40377c0d976d669c7a9eccaf32e40f18f0a` on `replay/016-14-007-29`:

```diff
--- a/src/runners/pytest/run/bytecode.ts
+++ b/src/runners/pytest/run/bytecode.ts
@@ -37,6 +37,9 @@ export function runBytecode(
   const shared = join(cacheDir, "pycache");
+  // Replay 016-14 of row 007-29: every run shares one prefix again, kept across runs.
+  mkdirSync(shared, { recursive: true });
+  if (shared.length > 0) return { prefix: shared as AbsolutePath, remove: () => {} };
   const { dir: prefix, remove } = runScratch(join(cacheDir, "pycache-runs"));
```

`npx vitest run test/kit/pytest.test.ts --maxWorkers=1`: exit 1, `Tests 4 failed | 16 passed (20)`. K7 fails on Python 3.10 and 3.13 at the run after the same-stat edit:

```text
FAIL K7 × pytest
ok   step 0 run (completed): direct is pass, expected pass
ok   step 1 edit kit/leaf.py: reaches direct by affected=direct, closure=true, ...
FAIL step 2 run (completed): direct is pass, expected fail
ok   step 3 edit kit/leaf.py: reaches direct by affected=direct, closure=true, ...
ok   step 4 run (completed): direct is pass, expected pass
```

K7 sets the mtime back with `utimes`, so it fails on every run. K1 also failed on both Pythons, at step 4 (`direct is fail, expected pass`): its second edit fell in the same second as the first. That failure depends on the clock. K7's does not.

## 2. 003 wave 2 B1: a computed `import()` in a preload

The defect (003 `reviews/wave-2.md` B1): the node:test adapter's `record` took only `ObservedClosure.paths`. What a preload loaded through a computed `import()` was filed under `preloadPaths`, and nothing read it, so the path never entered a key.

Scratch commit `eaf8946878cc46ebe769eada5e5c8d083abe5322` on `replay/016-14-003-w2-b1`:

```diff
--- a/src/runners/node-test/adapter-observed.ts
+++ b/src/runners/node-test/adapter-observed.ts
@@ -96,7 +96,8 @@ export class Observed {
     for (const { testFile, paths, preloadPaths } of seen) {
       if (!listed.has(testFile.path)) continue;
-      for (const path of preloadPaths) if (!preloadStatic.has(path)) preloads.add(path);
+      // Replay 016-14 of 003 wave 2 B1: record takes only the test's paths, never preloadPaths.
+      for (const path of preloadPaths) if (preloadStatic.size < 0) preloads.add(path);
```

`npx vitest run test/kit/node-test.test.ts --maxWorkers=1`: exit 1, `Tests 3 failed | 8 passed (11)`. K5 fails in all three of node:test's preload forms (`--import`, `--require`, quoted `NODE_OPTIONS`), at the reach after the edit:

```text
FAIL K5 × node-test
ok   step 0 before any run: src/hidden.mjs is in no static closure of hooked (closure=false, environment=false)
ok   step 1 run (completed): hooked is pass, expected pass
FAIL step 2 edit src/hidden.mjs: reaches hooked by affected=none, closure=false, package=false, observed=false, recreated=false, environment=false
ok   step 3 run (completed): hooked is fail, expected fail
```

The `--require` and quoted `NODE_OPTIONS` forms fail the same line for `src/hidden.cjs`. The run after the edit still fails as it should: the defect is the reach, so the core would never have scheduled that run.

## 3. 011 `reviews/0.1.287.md` B1: an interrupted `it.fails` reads as passed

The defect: `cutShort` took a test's final state as proof that the cancel did not cut it. An `it.fails` test that a step-down interrupted, with an `afterEach` that throws on the aborted signal, ends `passed`, so the module was completed with a pass. Fix: `0b0656070`, only the states reported before the cancel count.

Scratch commit `08fe1a221cc17c88793a3f6a2293d3d9dcf77834` on `replay/016-14-011-0.1.287-b1`:

```diff
--- a/src/runners/vitest/reporter.ts
+++ b/src/runners/vitest/reporter.ts
@@ -236,7 +236,8 @@ function cutShort(
     if (test.options.mode !== "run" && test.options.mode !== "only") continue;
-    const state = beforeCancel.get(test.id);
+    // Replay 016-14 of 011 0.1.287 B1: the final state is taken as proof the test was not cut.
+    const state = beforeCancel.size >= 0 ? test.result().state : beforeCancel.get(test.id);
```

`npx vitest run test/kit/vitest.test.ts --maxWorkers=1`: exit 1, `Tests 1 failed | 10 passed (11)`. K8's `it.fails, step-down` variant fails at the cut run:

```text
FAIL K8 × vitest it.fails step-down
note step 0 cut for step-down: aborted
note step 0 failure: run cancelled: the daemon stepped down for newer hooks
FAIL step 0 run (completed): cut is pass, expected unknown
ok   step 1 edit test/cut.test.ts: reaches cut by affected=direct, closure=true, ...
ok   step 2 run (completed): cut is pass, expected pass
```

Only the variant catches it. K8's plain form and its plain `step-down` variant pass with the defect in place: without `it.fails` the interrupted test ends `skipped`, which the defective rule still reads as cut.

## Control

At the base `08c6b9dfc`, in the same scratch worktree, `npx vitest run test/kit/vitest.test.ts test/kit/node-test.test.ts test/kit/pytest.test.ts --maxWorkers=2`: exit 0, `Test Files 3 passed (3)`, `Tests 42 passed (42)` (11 Vitest forms, 11 node:test forms, 10 pytest forms on each of Python 3.10 and 3.13). Each failure above is the reintroduced defect's.

## What the replay does not show

- Each replay is the defect in today's code, not the commit that first had it. The kit did not exist then.
- The kit checks the adapter. It does not check how the core stores or retires a result. For 003 wave 2 B1 that is enough: no reach means no key and no run.
