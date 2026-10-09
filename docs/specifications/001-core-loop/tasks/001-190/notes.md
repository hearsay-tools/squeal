# 001-190 notes: `why` names a producer only when its run stored the state shown

Repair of `reviews/wave-13j.md` B4.

## Decision (coordinator, 2026-10-09)

No run id is recorded with the known state: a column on `known_states` is
schema step 2, and every older daemon refuses a newer shared store; a
per-worktree meta map is another unpruned prefix (wave-13j S4). Instead, an
inherited state names a row only when the row provably predates the state.

## Rule

- `src/core/status/why.ts` `observedSince`: the earliest time a state
  observed at revision `n` can have been applied. `n >= 1`: that revision's
  `createdAt`. `n = 0` (the bootstrap before any change): the worktree's
  `registeredAt`, which the daemon keeps from the first registration and
  writes before it starts the scheduler (`src/core/daemon/daemon.ts`
  `#register`). `null` when neither is stored.
- `src/core/status/run-log.ts` `shownResult`: an inherited state names a row
  only if its `provenance.recordedAt <= observedSince`, in addition to the
  001-188 predicate (outcome, commit, producer worktree, the current key for a
  current state, exactly one candidate otherwise). Why it is sound: the state
  was applied at or after `observedSince` from the row then at the key, and a
  row that replaced it is recorded later. `observedAt` of an inherited state is
  kept while it re-applies unchanged, so a state re-applied from a replacement
  names none (honest, not wrong).
- Own states are unchanged: every own run re-derives its own states.

## Known false negatives

An inherited result stored after the revision it was applied at (B queued at
revision n, A's result lands later, B's refresh applies it at n) names no
producer. Proving it would need the run id on the state.

## Tests

- `test/status/why-replaced.test.ts`: the reviewer's real-Vitest probe (FIRST
  OUTPUT, forced A PASS -> PASS with SECOND OUTPUT; B names the first run
  before and none after); seeded same-commit same-revision and
  different-revision replacements; a row recorded before the state is named.
- `test/status/helpers.ts` `appendRevisions` takes the last revision's
  `createdAt`; `why-seed.ts` dates `b`'s revision 2 after its seeded results.
