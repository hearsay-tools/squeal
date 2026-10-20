# Review of cand/0.1.228, the format-18 bundle

Use /reviewer. Shape: review. Pinned to the `cand/0.1.228` SHA named in the spawn; the range is `origin/main..<sha>`: six rows cherry-picked with `-x` (001-365, 011-39, 011-33, 011-31, 013-02, 011-38), two integration commits (one key format 18 with its hash re-pinned; the 011-39 accept harness's `keysReadAsOne` stub), the release commit (version 0.1.228 and the bundles) and this brief. Under the human's interim rule (2026-10-20) the rows with guarded changes ship together, with one key raise.

Read the six board rows, their briefs (001-365: `003-node-test-runner/tasks/wave-5.md`; 011-31 and 011-33: `011-core/tasks/wave-6.md` W1 and W2; 013-02: `013-vitest-runner/tasks/wave-1.md`; 011-38 and 011-39: `tasks/011-37/briefs.md`), `tasks/011-37/design.md` sections 4 and 6, `tasks/011-30/design.md` sections 1, 3 and 5, `013-vitest-runner/tasks/013-01/design.md` sections 2 and 6, spec 011 C3, C4 (step 3, the "Explicit checkpoints" paragraph), C7 and C9 as amended 2026-10-20, 013 V5, and each row's `notes.md`. Check that:
- formats 13 to 17 can be read as 18. 013-02 narrows what a touch and the barrier withhold, 001-365 changes a note, and 011-31 and 011-33 change cancellation and the start baseline: none of them should change what a stored set means. Give your reading for each. `test/keys/validity/compare.test.ts` passes against the last release, and 013-02's barrier cases are compared later, in 011-40;
- 011-38: a miss reads the listed formats once per file and key, copies only the newest set stored at one, leaves a busy store's read to the next lookup, and risks 6 to 8 of design section 6 have tests;
- 011-33's handed-over files settle through the same lookup as every miss, with no second path beside 011-38's. `lookup-only` still queues no misses of its own;
- 011-31: a step-down cancels every lane's tier and backlog slot as `stop` does, and `ensure.ts` sends `stop` within C8's two round trips;
- 013-02: a touch withholds only the files the Vitest instance could have read, and the barrier only the files whose keys name the touched path;
- the merged `daemon.ts` and `test/version-sensitive.txt` keep both rows' edits.

Run `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree; name each file that fails loaded and passes alone. Write `reviews/format-18.md` with a PASS or FAIL verdict and commit it.
