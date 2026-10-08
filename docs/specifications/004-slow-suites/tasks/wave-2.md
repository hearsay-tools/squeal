# 004 wave 2 briefs

Read `docs/vision.md`, `docs/styleguide.md`, spec 004 as amended (`status.md`), and `reviews/wave-1.5.md` "Inputs for the next wave". Do not run `npm run build`; the coordinator builds at integration. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Load on this host is high: re-run a failing file alone before calling it yours. A test that runs a slow file under a real daemon sets `slow.maxLoadPerCpu` high.

## 004-15 the slow-tier line, the failure line, the primer and `stop.requireSlowSuite`

Outcome: the agent and the human see the slow tier's state wherever they see status, a slow failure says what it ran against, the primer tells the truth about slow suites, and `stop.requireSlowSuite` holds a main agent until slow files are current.

Read: spec 004 D7 (`stop.requireSlowSuite`), D8, D9; 001 D6 (provenance), D7, D9 (primer); 004-20's `StatusHeader.slowPending` and `isFastPending` (`src/core/state/header.ts`).

Shape: slice. Test first. Seams, in order:
1. `readHeader` fills `slowPending` for every caller from the policy's slow predicate, in its one read transaction; the delivered header and `squeal status` (`src/core/status/format-status.ts`, the header formatter in `src/core/delivery/`) gain D8's one slow-tier line when slow files are declared: count; current at revision N against the artifact ("sources changed since" when a source changed after N and the artifact did not); running since HH:MM with the last duration; pending, waiting for idle, the slot or load; not run at this revision; "not covered by Stop's wait".
2. The pending reason is the daemon's: publish it from `SlowTier` (`src/core/scheduler/slow-tier.ts`) through a new `src/core/slow/state.ts` (a store meta key per worktree); keep the lines in `slow-tier.ts` minimal and in their own commit (004-18 also edits that file).
3. `src/core/delivery/provenance.ts`: a slow failure's line per D8.
4. `src/harness/shared/primer.ts` and both `SKILL.md`: with a slow tier, drop "Squeal does not cover ... other suites", say slow suites run when the agent pauses or on `squeal run --slow`; Codex texts say a slow failure arrives with the next prompt or tool call (D9).
5. `stop.requireSlowSuite` in `src/harness/shared/stop.ts`, beside `requireFullSuite`.

Owns: `src/core/status/**`, `src/core/delivery/**`, `src/core/state/**`, `src/harness/shared/**`, `src/core/slow/state.ts`, those lines of `slow-tier.ts`, both `SKILL.md`, their tests. Leave alone: the rest of `src/core/scheduler/**`, `src/core/daemon/**` and `src/runners/**` (004-18, 003-40). If a recorded hook fixture under `test/harness/recorded/` must change, say so.

Done when: status and delivery tests for each state of the line; a provenance test; primer tests with and without a slow tier, both harnesses; Stop tests with `requireSlowSuite` on and off; lint, typecheck, full suite on Node 24 and 22. Report every type change.

Use /worker.
