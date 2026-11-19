# Spec 021, wave 10: a store process per clone, `code.sqlite` first

The human, 2026-11-19, proposed a dedicated store process per clone in place of an in-daemon writer role (`021-34/design.md` section 6, last paragraph); spec D22 records it. Coordinator 8f88fe1f. One row.

## 021-36: a store process per clone, first slice `code.sqlite`

Use /worker. Shape: slice.

Outcome: on one clone, every daemon's `code.sqlite` writes go to one store process, which is the file's only regular writer; with no store process, daemons write directly as today.

Read: spec D22 (all of it), D15, D1, D2, D3; `021-34/design.md` sections 4 to 6; `tasks/021-16-notes.md` (how D15 was built); `021-36/role-moves.md` once present (the coordinator's count of how often an in-daemon role would have moved).

Seam: `src/core/delivery/sending-connection.ts` and `daemon-writer.ts` (the client: reuse, do not fork), `src/core/daemon/write-desk.ts`, `write-batch.ts`, `sliced-writes.ts` (the server side to reuse), `src/core/code/store/open.ts` and its callers (`code/pass/index.ts`, `code/coverage/writer.ts`, `daemon/keep-request.ts`), `src/core/daemon/lock.ts` and `ensure.ts` (start under a lock), `src/cli/main.ts` (a hidden `store-process` command beside `runner-host`), `src/core/ps/` (list it). First edit, offered as a lead: a `code.sqlite` connection factory that returns a `SendingConnection` whose sender is the store process's socket, falling back to `Connection` when none answers. Before code, list in `tasks/021-36-notes.md` each code-store transaction that reads inside itself and how its decision stays valid (D22.5).

Owns: the files above, new files under `src/core/store-process/` (or a name you justify), their tests, `tasks/021-36-notes.md`. Leave alone: `src/core/code/store/schema.ts` and the index build at open (row 021-35, planned), `src/core/capacity/`, `store.sqlite` and `lint.sqlite` write paths, `docs/board.md`, `spec.md`.

Done when: tests show (1) two daemons on one clone record complexity and coverage through one store process, and their busy wait on `code.sqlite` is 0 (count busy-handler waits); (2) a store process killed mid-batch leaves the clients to write directly within D1's bound, each batch written once; (3) two daemons starting at once start one store process; (4) it exits after its last client's grace; (5) a schema mismatch falls back to direct writes; (6) queue order: a worktree's batches in order, edit-tier first, prune last. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite. Run any direct Vitest with a timeout (`timeout 600`); leave no orphan processes; stop any daemon or store process your tests start. Do not run `pnpm run build`.

## 021-36 rebuild: one owner per batch (after two failing reviews)

The human, 2026-11-19, on the card after re-review R1 of `cand/0.1.571` failed: "A: rebuild on one rule". Use /worker. Shape: repair (rebuild of one seam).

Outcome: the daemon side of the store process follows spec D22.3 and D22.4 as amended today: the relay thread owns each batch until it is written exactly once, writes directly only when the store process's lock file is free, ends a store process that does not answer a ping, and the daemon's main thread never blocks on a write.

Read: spec D22 (3 and 4 amended); `reviews/0.1.571.md` (both rounds: B2, B5, N1 and why the patches did not converge); `tasks/021-36-notes.md` sections 1, 3, 4, 8, 9.

Starting point: this branch (`cand/0.1.571` at `8d394d5ce` plus the review files). Keep what passed review: the store process, its queue and schema check (B3), start and stop (B1, the leaving release, the gone-file check), `squeal ps`, the long-write lines (B6), the D22.6 lines, the D22.5 statement rewrites. Replace in `src/core/store-process/relay.ts` and `relay-thread.ts`: the `Atomics.wait` on the main thread, the timeout fallback, the cancel path and the 30 s cap. Lead: `relay.send` returns a promise and the main thread never waits; the 7 read-back callers of notes section 1 (and any caller that relied on precondition P) await their own earlier batches (`sent()`); a hung store process is detected by a ping to its socket thread, not by a slow write.

Owns: `src/core/store-process/`, the code-store callers in `src/core/code/**`, `src/core/daemon/daemon.ts`, `keep-request.ts`, their tests, `tasks/021-36-notes.md` (new section 10). Leave alone: `src/core/code/store/schema.ts` and the open-time index build (021-35), `store.sqlite` and `lint.sqlite` paths, `docs/board.md`, `spec.md`.

Done when: tests turn each review proof into a regular test and pass: (B2) store process stopped (`SIGSTOP`) with an outside lock held 31 s, then the caller retries: history has one row; (B2) ordinary contention with a 200 ms busy timeout never blocks the daemon's main thread (measure event-loop delay, under 50 ms); (B5) a lost acknowledgement of a committed batch: counted once as written by the store process, and not written again; (N1) the last leaving release while its write is pending stops the store process once the write settles; `test/code/crap/chain-load.test.ts` passes (it fails at 132 to 154 ms on the candidate against its 100 ms line); the two store-process start tests that timed out on CI Node 22 (`logs.test.ts:101`, `processes.test.ts:63`): find the cause, not only a longer wait. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite; direct Vitest with `timeout 600`; leave no process; do not run `pnpm run build`.
