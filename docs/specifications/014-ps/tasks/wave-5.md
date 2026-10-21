# 014 wave 5: what round 2 found

From `lessons.md` "Round 2 (014-30)", P9 and P10. Rows 014-31 and 014-32 run in parallel on disjoint files. Row 014-33 waits for the human's decision on goal 6. Workers: `--runner claude --model opus --effort xhigh`. Verdict: `squeal run --all --wait`; no `npm run build` in a worker tree.

## 014-31 a held lock missed by one `/proc/locks` read

Use /worker. Shape: slice. **Outcome:** no state, flag or end command says a lock is absent unless both readings of the snapshot miss it. **Read:** `lessons.md` Round 2 (P9, the `no-lock` judgement); spec D2 step 3, D6, D7. **Seam:** `src/core/ps/discover.ts` `holds()` (line 182) takes one `locks()` reading. A second reading at the end of the CPU window is the lead; a lock in either reading is held. Cover every absence claim: `waiting` and `no-lock`, `duplicate`'s pick (`flags.ts:390`), `stale-socket`'s owner (`discover.ts:217`), `work.ts:89`, and the permits of `host.ts`. **Owns:** `discover.ts`, `flags.ts`, `host.ts`, `work.ts`, `snapshot*.ts`, their tests; one line in spec D2 or D7 named in your final message. **Leave alone:** `test/evals/`. **Done when:** a test whose first reading misses a held lock prints none of those claims; a daemon absent from both readings is still `waiting` and `no-lock`; the cost test stays green, with its numbers.

## 014-32 the evals fake daemons outlive their cell

Use /worker. Shape: slice. **Outcome:** a fake daemon that `test/evals/fake-cell.ts` starts is gone when its cell is torn down. **Read:** `lessons.md` Round 2 (P10; pids 1310860 and 1310869 lived 60 to 86 min after their root was removed). **Seam:** `FAKE_SQUEAL`'s `daemon` branch and the cell teardown that removes the root. Find first why the process outlives the removal. **Owns:** `test/evals/fake-cell.ts` and the evals test helpers that tear a cell down. **Leave alone:** `src/`, `test/ps/`. **Done when:** a test starts a cell, tears it down, and finds no process of its fake daemon; the evals tests pass. The 014 decision: an unknown daemon still stops `leftover-temp` and `orphan-test-process` for the whole host (D7); only the leak is fixed.

## 014-33 goal 6's CPU

Held for the human (`lessons.md` Round 2: 0.38 to 0.51 s in 15 of 15 runs at load 41 to 82; Node's start alone 0.15 to 0.19 s). The brief follows the decision.

## 014-34 review of wave 5

`/reviewer` on the candidate, `--runner codex --model gpt-6.1-sol --effort high`.

## 014-35 dogfood, round 3

Use /worker. Shape: finish. After wave 5 is released. Round 2's method (`/tmp/dogfood-014-30/bin/`) on the released bundle: goals 4 and 6, and P1, P5 and P8 live once no fake daemon stops their rules. **Owns:** `lessons.md`.
