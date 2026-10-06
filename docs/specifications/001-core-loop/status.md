# 001 Core validation loop: status

Stage: shipped (2026-10-06: the dogfooding re-run in `lessons.md`, section "Re-run after waves 4.5 and 4.6", found goals 1 to 7 holding with Claude Code and no new blocker; open, not blocking: lessons defects 8, 9 and 10, and macOS verification before any public release)
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

- 2026-10-06, dogfooding re-run (001-46, `lessons.md`): no spec change. Three new defects, recorded there: Claude Code skips SessionEnd on an interactive exit after a typed prompt, so consumers stay registered until the 12 h expiry (8); `stop.blockOnKnownFailures` blocks Claude Code's `prompt_suggestion` fork at SubagentStop (9); no idle waiter after an interrupted turn (10).

- 2026-10-06, wave 6 (001-47, 001-48): interactive consumers expire 10 minutes after their waiter is gone, and a timed-out waiter records its consumer as heard from (D10); `UserPromptSubmit` re-arms the waiter and re-registers an expired interactive consumer, and internal forks (empty `agent_type`) are not consumers (D9). Forks under `claude --agent <name>` are not detected. Claude Code 2.1.291 sent no SubagentStart for forks, so the recorded fork SubagentStart fixture is synthetic.

- 2026-10-06, from the wave 6 review (`reviews/wave-6.md`): no blocker; defects 8 and 10 confirmed gone in an attended re-run (consumers expired 10 to 11 minutes after exit, a waiter armed after an Esc). D9 idle-waiter paragraph amended for UserPromptSubmit arming and the timeout touch (N3). Accepted: the sub-millisecond lock-probe windows of N1 (a lost waiter or consumer is restored by the next prompt) and every daemon of a store running the expiry pass over all worktrees (N5). S1, S2, N2 and N4 are row 001-50.

- 2026-10-06, wave 6.5 (001-50, from `reviews/wave-6.md` S1, S2, N2, N4): UserPromptSubmit injects the registration whenever it registers; a SubagentStop with no registration gets the fork behaviour, which covers forks under `--agent`; PostToolBatch and PreToolUse ignore forks (D9). Confirmed in an attended session (001-51, `lessons.md` "Attended check after wave 6.5"); defects 8 to 10 are closed.

- 2026-10-06, wave 7 (001-53, `lessons.md` defect 11): an add or delete invalidates only the transforms whose imports it can re-resolve, the deleted path's importers and the importers of a target that has the added path among its resolution candidates, instead of every cached transform (D4). On a 1,000-module fixture, `affected` after an add costs 13 to 17 ms against 10 to 13 ms warm locally, and 33 ms against 14 ms warm on CI, where the add's fixed cost (re-globbing test files, transforming the new file) is about 20 ms; corrected by 001-56 from "1.3 to 1.5 times the warm walk", a one-machine figure (`reviews/wave-7.md` S1). The `cezar` probe in `lessons.md` has not been re-run.

- 2026-10-07, wave 7.5 (001-56, from `reviews/wave-7.md` B1, S1, S2, N1, N3, N4): an add also stales unresolved non-relative imports (alias, `tsconfig` `paths`, package), modules whose source on disk uses `import.meta.glob` or a template-literal dynamic import (a cached scan, chosen over a `createVitest` plugin that Vitest does not pass to projects with their own Vite server), resolved imports under a directory the added path shadows, and imports under the directory of an added or deleted `package.json`; a Vite without `invalidationState` falls back to invalidating every transform, with one note (D4). Figures in D4 give local and CI numbers. `Object.keys(import.meta.glob(...))` compiles to keys without imports, so its matched files are not in the closure (D3 gap, not a staleness one, the same under `invalidateAll`).

## Research

Complete. Four findings documents under `research/`, all with experiments on Linux. Nothing verified on macOS.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `0002-content-keyed-shared-store.md`, `0003-delivery-model.md`
- Spec: `spec.md`
