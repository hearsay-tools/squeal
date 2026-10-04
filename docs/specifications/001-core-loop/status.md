# 001 Core validation loop: status

Stage: in-progress (approved 2026-10-04; wave 0 done, wave 1 running)
Started: 2026-10-02

## Decisions so far

- Stack: TypeScript, Vitest first, Claude Code first (ADR 0001).
- Project state lives in the main worktree and is shared by all worktrees of the same repo. Worktrees read and write there.
- A new worktree inherits the baseline from the shared store automatically. Spec 001 must choose a state model that makes this a lookup, so a later spec never undoes it.
- Agents receive a diff between what they were last told and the current known state, computed at delivery time, never a replay of raw events.
- Result validity is per check, not per run. No cancel-and-restart on new changes.
- Delivery must reach the agent mid-turn, at tool boundaries, not only at the end of a turn.

## Amendments after approval

- 2026-10-04, from wave 0 type review: added `test_file_keys` and `known_states` tables (D8), `skip` as a known outcome (D6), rule that `unknown` is never stored under a content key (D8).

- 2026-10-04, from the wave 1 review (`reviews/wave-1.md`): closures include absent resolution candidates and the snapshot path (D3); policy inputs are closure inputs only (D3); full invalidation on add or delete and duplicate-name suffix rule (D4); lockfile and generated closure files watched, no keying with untracked paths (D2); checkpoints table, last-used eviction, text-exact failure dedupe, check retirement (D8, D7); unattributed unhandled error is a crash, timeout keeps completed files (D12).

- 2026-10-04, from the wave 2 review (`reviews/wave-2.md`): runner failure is a state not a skip, revision atomic with content re-key and queued phases, checkpoints abandon on unkeyed files (D5); file-level check passes on load, retired told failures delivered as resolved, header carries test-file counts and shared readers (D6); persisted notes in status (D7); shared-key last-writer rule accepted (D8); PreToolUse peek of regressions only (D9); run timeout default 10 minutes (D11).

## Research

Complete. Four findings documents under `research/`, all with experiments on Linux. Nothing verified on macOS.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `0002-content-keyed-shared-store.md`, `0003-delivery-model.md`
- Spec: `spec.md`
