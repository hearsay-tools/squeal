# Wave 27 (rows 023-44, 023-47). Use /worker.

The human chose (2026-11-22): release 0.1.597 and run dogfood round 6 ("Release + dogfood"), and fix row 023-47 in spec 023 now ("Spec 023 now"). 0.1.597 is released (tag `squeal--v0.1.597`, hub `e74aa47`). Never write the lab VM host name, the company name, sandbox ids, account names or home paths in committed files (`pnpm run check:private` with `set -o pipefail`; grep your diff).

## Row 023-44: dogfood round 6 on 0.1.597

Question: with spec D7 shipped (`status --at --run` on the commit daemon and the worktree daemon, 100 s wait then return with the rest running, a later `--wait` joining; `proof`'s passing side on the commit daemon), do agents asked a before/after question now reach a full and right answer with no hint, inside a 1,200 s session?

- Read `../lessons.md` rounds 4 and 5 (verdicts, columns, misread texts), `tasks/wave-19.md` (round 5's brief: isolation, recording and cleanup rules all hold), `tasks/023-33/` (scripts and prompts to reuse), `tasks/023-32/` (the boat.dev variant), `~/projects/notes/AGENTS.md` then `~/projects/notes/topics/boat-dev.md`.
- **Where:** your own boat.dev sandbox. Round 5 ran on the lab VM only because the sandbox had no model credential (the human allowed it once). First check whether a boat.dev sandbox can run Claude Code sessions now without forwarding this host's credential (the notes topic says how credentials reach sandboxes, if they can). If it cannot, stop and report to the coordinator before running anything: the place is the human's decision. Never forward this host's ANTHROPIC credential into a sandbox; never use the lab VM without the coordinator's word.
- **Release under test:** 0.1.597 installed as a user installs it (the release's `install.sh` and the hub entry `e74aa47`).
- **Isolation (hard rule):** a throwaway OS user, credentials passed by name only, never read, printed, copied or written, as rounds 3 to 5.
- **Sessions (prompts exactly as round 5, no hint):** s1 (squawk before/after, empty store) 10; s2 (Squeal before/after, empty store) 10. At most 3 at once, `timeout 1200` each, Sonnet.
- **Record per session and judge per group** (round 5's columns, plus: calls that returned at the wait with work still running, and whether a later `--wait` joined it; whether the agent read the "still running" line right; commit daemons and worktrees left after the session; `proof` used and read right).
- **Write:** a "Round 6 (023-44)" section in `../lessons.md`, verdict first, counts per group against round 5; scripts and data under `tasks/023-44/`. Proposals, not code.
- **Budget:** 20 sessions; stop and tell the coordinator if model cost passes $8. Delete the sandbox at the end and report its cost.
- **Done when:** sessions ran (or each that could not is named with its reason); lessons and `tasks/023-44/` committed; check:private passes; the sandbox deleted.

## Row 023-47: a rewritten first-seen input is not kept at the shared pre-run key

Board row 023-47; found by row 023-42; the repro is the `it.fails` case in `test/cli/proof-shared-key.test.ts` ('a control run of a test that rewrites its first-seen input leaves no failure at HEAD's key'); mechanism in `tasks/023-42-notes.md`. A run that reads an input for the first time and that input changed during the run is kept at the key its file had before the run (the static, pre-observation key, which two commits can share), and the read is not recorded; the result then answers every reader at the other commit, persistently.

- Read spec 023 D2, spec 020 and spec 018's keep rules for first-observation runs (the gate's keep decision, the observed set, the "read paths first seen during the run" handling), `tasks/023-42-notes.md` and the repro test.
- **Fix:** a run whose observed inputs changed during the run, or whose first-seen reads are not recorded, must never be stored at a key that does not cover what it read. Prefer: record the read and store at the post-run key when the inputs are stable, else do not keep the result (as the gate already does for 'read paths first seen during the run'). The key format must not change unless unavoidable; if it must, stop and tell the coordinator first.
- **Tests:** turn the `it.fails` case into a passing test (red on the old code); add a case through `status --at` and a worktree daemon at HEAD (no reader at HEAD sees the base commit's failure); keep `test/keys/key-format.test.ts` and the validity cases green.
- **Ownership:** the gate's keep rule and observation recording (spec 020/018 files: `src/core/gate/**`, `src/core/scheduler/record*.ts`, observe handling as needed; coordinator-approved, commit subjects say "(spec 023 row 023-47; 020/018 files, coordinator-approved)"), tests beside them, `tasks/023-47-notes.md`. Not `src/cli/proof*` or `status-at*` unless a test needs a hook.
- **Rules:** no full suite; `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; `squeal status --wait 60000 <changed paths>`; lint, typecheck, check:private; no build, no version bump, no board edit.
