# Review of cand/0.1.250 (013-06)

Use /reviewer. Shape: review. Pinned to the `cand/0.1.250` SHA named in the spawn; the range is `b9062dd94..<sha>`: 013-06's two code commits (`feat(013-06)`, the validity cases by agreement), the worker's notes and the release commit (0.1.250, bundles; no key-format or adapter version raise).

Read `brief.md` and `notes.md` beside this file, `../../research/vitest-close-leak.md` 1, 3 and its recommendation, 013 V1 and V8, and 004 D2. Check that:
- every awaited close in the brief empties the instance after the close resolves: `#recreate`, the adapter's `close()` (also the slow pass's, through `withSlowInstance`), `closeBroken`, `closeRejected`; `abandon` is unchanged;
- nothing can read an emptied object later: no run, reporter callback, watcher event, timer or Rolldown native callback (the retainer of rolldown#10887) that fires after the close may throw outside a caught path, since an uncaught throw ends the daemon;
- plugin objects are left alone, and a config that shares one plugin object runs after a recreate;
- the reads moved in `run()` give the same result as before on the normal path;
- the two validity cases reach the changed lines at both trees, and passing the key-format test without a version raise is right because no key's meaning changed;
- the tests failed before the change, and they prove the instance emptied and its module graphs collected (the notes say why not a cleared `WeakRef`);
- the deviation is acceptable: a failed `#start` is not emptied (0.36 to 0.72 MiB per failed start, `notes.md` decision 4);
- the version is 0.1.250 in all eight places and the bundles match the tree.

Run `npm ci`, `npm run lint`, `npm run typecheck`, then `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. No `npm run build`. Files known to fail on this loaded host and not in this range: `test/e2e/shipped-plugin.test.ts` (014-17), `test/harness/opencode-dispose.test.ts` (008-38), `test/scheduler/backlog-slots-overhead.test.ts` test 3 (timing under load), `test/e2e/stop-gap.test.ts` (011-20). Name any that fail; a file that fails loaded and passes alone is named with the load. Write `../../reviews/0.1.250.md` with a PASS or FAIL verdict and commit it.
