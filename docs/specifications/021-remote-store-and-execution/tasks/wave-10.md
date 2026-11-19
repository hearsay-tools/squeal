# Spec 021, wave 10: a store process per clone, `code.sqlite` first

The human, 2026-11-19, proposed a dedicated store process per clone in place of an in-daemon writer role (`021-34/design.md` section 6, last paragraph); spec D22 records it. Coordinator 8f88fe1f. One row.

## 021-36: a store process per clone, first slice `code.sqlite`

Use /worker. Shape: slice.

Outcome: on one clone, every daemon's `code.sqlite` writes go to one store process, which is the file's only regular writer; with no store process, daemons write directly as today.

Read: spec D22 (all of it), D15, D1, D2, D3; `021-34/design.md` sections 4 to 6; `tasks/021-16-notes.md` (how D15 was built); `021-36/role-moves.md` once present (the coordinator's count of how often an in-daemon role would have moved).

Seam: `src/core/delivery/sending-connection.ts` and `daemon-writer.ts` (the client: reuse, do not fork), `src/core/daemon/write-desk.ts`, `write-batch.ts`, `sliced-writes.ts` (the server side to reuse), `src/core/code/store/open.ts` and its callers (`code/pass/index.ts`, `code/coverage/writer.ts`, `daemon/keep-request.ts`), `src/core/daemon/lock.ts` and `ensure.ts` (start under a lock), `src/cli/main.ts` (a hidden `store-process` command beside `runner-host`), `src/core/ps/` (list it). First edit, offered as a lead: a `code.sqlite` connection factory that returns a `SendingConnection` whose sender is the store process's socket, falling back to `Connection` when none answers. Before code, list in `tasks/021-36-notes.md` each code-store transaction that reads inside itself and how its decision stays valid (D22.5).

Owns: the files above, new files under `src/core/store-process/` (or a name you justify), their tests, `tasks/021-36-notes.md`. Leave alone: `src/core/code/store/schema.ts` and the index build at open (row 021-35, planned), `src/core/capacity/`, `store.sqlite` and `lint.sqlite` write paths, `docs/board.md`, `spec.md`.

Done when: tests show (1) two daemons on one clone record complexity and coverage through one store process, and their busy wait on `code.sqlite` is 0 (count busy-handler waits); (2) a store process killed mid-batch leaves the clients to write directly within D1's bound, each batch written once; (3) two daemons starting at once start one store process; (4) it exits after its last client's grace; (5) a schema mismatch falls back to direct writes; (6) queue order: a worktree's batches in order, edit-tier first, prune last. Lint, typecheck, `squeal status --wait 60000 <changed paths>`. No full suite. Run any direct Vitest with a timeout (`timeout 600`); leave no orphan processes; stop any daemon or store process your tests start. Do not run `pnpm run build`.
