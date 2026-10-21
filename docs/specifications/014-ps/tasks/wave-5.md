# 014 wave 5: what round 2 found

From `lessons.md` "Round 2 (014-30)", P9 and P10. Rows 014-31 and 014-32 run in parallel on disjoint files. Row 014-33 runs beside them on its own files (the human kept goal 6 at 0.3 s, 2026-10-21). Workers: `--runner claude --model opus --effort xhigh`. Verdict: `squeal run --all --wait`; no `npm run build` in a worker tree.

## 014-31 a held lock missed by one `/proc/locks` read

Use /worker. Shape: slice. **Outcome:** no state, flag or end command says a lock is absent unless both readings of the snapshot miss it. **Read:** `lessons.md` Round 2 (P9, the `no-lock` judgement); spec D2 step 3, D6, D7. **Seam:** `src/core/ps/discover.ts` `holds()` (line 182) takes one `locks()` reading. A second reading at the end of the CPU window is the lead; a lock in either reading is held. Cover every absence claim: `waiting` and `no-lock`, `duplicate`'s pick (`flags.ts:390`), `stale-socket`'s owner (`discover.ts:217`), `work.ts:89`, and the permits of `host.ts`. **Owns:** `discover.ts`, `flags.ts`, `host.ts`, `work.ts`, `snapshot*.ts`, their tests; one line in spec D2 or D7 named in your final message. **Leave alone:** `test/evals/`. **Done when:** a test whose first reading misses a held lock prints none of those claims; a daemon absent from both readings is still `waiting` and `no-lock`; the cost test stays green, with its numbers.

## 014-32 the evals fake daemons outlive their cell

Use /worker. Shape: slice. **Outcome:** a fake daemon that `test/evals/fake-cell.ts` starts is gone when its cell is torn down. **Read:** `lessons.md` Round 2 (P10; pids 1310860 and 1310869 lived 60 to 86 min after their root was removed). **Seam:** `FAKE_SQUEAL`'s `daemon` branch and the cell teardown that removes the root. Find first why the process outlives the removal. **Owns:** `test/evals/fake-cell.ts` and the evals test helpers that tear a cell down. **Leave alone:** `src/`, `test/ps/`. **Done when:** a test starts a cell, tears it down, and finds no process of its fake daemon; the evals tests pass. The 014 decision: an unknown daemon still stops `leftover-temp` and `orphan-test-process` for the whole host (D7); only the leak is fixed.

## 014-33 goal 6's CPU: cut Node's start-up

Use /worker. Shape: slice, measurement first. The human chose (2026-10-21): goal 6 stays 0.3 s of CPU for the whole command; cut the start-up. **Outcome:** `squeal ps`, run as a user runs it, uses at most 0.3 s of CPU on this host. **Read:** `lessons.md` Round 2, goal 6 and P3; spec goal 6, D1, D11. **First:** five runs each, with the load, of `node -e 0`, of loading `plugins/claude-code/dist/cli/squeal.mjs` without a command, and of `squeal ps`, in CPU (user plus system). **Seam:** the 2.4 MB `squeal.mjs` bundle loads every command before `src/cli/main.ts` dispatches. The lead: `ps` loads only its own code, by a separate entry in the plugin build (`src/harness/build.ts`) or a lazy import that the bundle splits. Nothing `ps` runs may write a file, so no compile cache (goal 4). **Owns:** `src/cli/main.ts`, `src/cli/ps.ts`, `src/harness/build.ts` and the four plugin `build.ts`, the launcher if routing needs it, their tests. **Leave alone:** `src/core/ps/` (014-31), `test/evals/` (014-32), `src/runners/vitest/` (013-06). Build only in a scratch copy, never in your worktree. **Done when:** five runs of the built command use at most 0.3 s of CPU, with the load and the counts. If the cut cannot reach it, report the measured floor of each part and stop: the bound does not change without the human.

## 014-34 review of wave 5

`/reviewer` on the candidate, `--runner codex --model gpt-6.1-sol --effort high`.

## 014-35 dogfood, round 3

Use /worker. Shape: finish. After wave 5 is released. Round 2's method (`/tmp/dogfood-014-30/bin/`) on the released bundle: goals 4 and 6, and P1, P5 and P8 live once no fake daemon stops their rules. **Owns:** `lessons.md`.
