# 001 Core validation loop: status

Stage: shipped-candidate (2026-10-06: waves 0 to 4.6 done; goals 1 to 7 hold per `reviews/wave-4.5.md`; remaining before shipped: a short dogfooding re-run with Claude Code, hook p95 at calm load, macOS verification before any public release)
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

- 2026-10-04, from wave 3 (001-31): the bundled hook entry points are committed under `plugins/claude-code/dist/` because a plugin install copies the git tree as it is; `npm run build` regenerates them, and CI must fail when they are stale (D9). `squeal.config.json` written by `squeal init` is plain JSON with every default spelled out; key documentation lives in the plugin skill and D11.

- 2026-10-04, from the wave 3 review (`reviews/wave-3.md`): hooks pass their shipped CLI to the daemon helper and Vitest is loaded from the project (D9, D11); Stop speaks only with news, waitMs capped at 1,500 ms, blocks only on current failures, SubagentStop unregisters, registration falls back to the first PostToolBatch, liveness in headers, PostToolBatch and Stop ensure the daemon on a stale heartbeat (D9); one non-throwing policy loader, bad policy is a state, reload on change (D11); per-user socket directory, recorded-socket probe, lock before store (D10); notes replace a daemon log (D12).

- 2026-10-04, from dogfooding (`lessons.md`): revisions never wait on the runner (D2); direct importers from the module graph first, shortest duration first within a class (D5); fingerprint normalizes UUIDs, long hex and temp paths (D6); `status --wait`, not-listed-yet state, dirty flag labelled with its revision (D7); `inputs` may map test-file globs to input globs (D11).

- 2026-10-06, from the wave 4.5 review (`reviews/wave-4.5.md`): refined-revision marker so deferred runner work counts as pending (D2); open questions 2, 4, 5 and 8 decided.

- 2026-10-06, wave 4.6 (001-45): file duration is the whole file for ordering (D5); `status --wait` has its own outcome without a daemon (D7); the SessionStart sweep only on `startup` and `resume` (D9); status says since when after a clean stop (D10). D2 holds without amendment: the runner phase of a refinement runs without the scheduler lock, and a batch during a 2 s runner phase waits 11 to 12 ms (`test/scheduler/refinement-lock.test.ts`).

## Research

Complete. Four findings documents under `research/`, all with experiments on Linux. Nothing verified on macOS.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `0002-content-keyed-shared-store.md`, `0003-delivery-model.md`
- Spec: `spec.md`
