# Wave 21 (row 023-37, research step): `status --at --run` and `proof` with `run --wait` semantics. Use /researcher.

The human decided (2026-11-21): no refusal before running; ship wave 20 (done, 0.1.586), then move `status --at --run` and `proof` to the `run --wait` model: work keeps running after the call ends, a later call reads it, files a later call names go first, and abandoned work finishes ("Finish everything"). Take-back goes away in that model. The coordinator's recommended direction (the human asked "a new checkout or another worktree and use its daemon?"): a worktree per commit with its own Squeal daemon, because the daemon already has the queue, `--wait`, the store, the per-run process cleanup and the per-user CPU pool.

Read: `../spec.md` (D1-D6, D4 steps 10-11), `../lessons.md` Rounds 4-5, `tasks/023-34-notes.md`, `tasks/023-36-notes.md`, spec 011's per-user pool (`../../011-core/spec.md`, the slot and permit rules), `src/core/checkout/**`, `src/core/commit/at-keys-*.ts`, `src/cli/status-at*.ts`, `src/cli/proof*.ts`, `src/core/daemon/` start and stop paths.

Questions (answer each with evidence; measure where asked):
1. **Worktree + own daemon vs a job in the user's daemon.** For each: what code exists and is reused, what is new, how `--wait` attaches on a second call, how results reach the store at the commit's keys, how the shared CPU pool bounds the load, how crash and SIGKILL cleanup works. Recommend one.
2. **Costs, measured** in Squeal's own repository and in squawk (`~/projects/cezar`, read only, clone it): worktree create + frozen install (cold and warm), daemon start to first run (lookup-only), disk per worktree, memory of an idle daemon.
3. **Lifetime.** When a commit's worktree and daemon stop and are removed (idle time after the last run and last waiting call, total cap, store retention of 7 days); how many may exist at once; what `squeal stop` and `squeal ps` show; the sweep after a crash.
4. **Identity and reuse.** One worktree per commit shared by calls and by other agents' worktrees of the same repository; what keys a result there (must equal the existing commit keys, D2); what happens when two calls ask different files of one commit.
5. **`proof`.** Which proof sides fit (no conditions: a worktree per (code commit, copied test files)); sides with `--env`, `--without`, empty `HOME`, `--repeat` stay in the call; whether that split is clean.
6. **What goes away:** take-back, the in-call batch loop, the run child, the completion record; what must stay for the in-call proof sides.
7. **Agent-facing text:** what `status --at <c> --run` prints when work is still running ("N still running; call again with --wait"), and the exit codes, matched to `run <group> --wait`.

Constraints: measurements on a boat.dev sandbox or this host only if light (no load on purpose); never the lab VM. Do not change product code. Never write sandbox ids, account names, the company name or the lab VM host name.

Output: `research/run-wait-model.md` (verdict first, one recommendation with its costs and risks, proposed spec amendments to D4/D5/D6 and a row split for building it), committed on your branch.
