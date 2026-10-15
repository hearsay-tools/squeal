# 001-420: a producer reference left by an older writer

Review 001-417 round 3, N2. A 0.1.195 daemon's state sink never writes
`failure-producers:<worktree>`, so when it rewrites a state the reference a
newer sink wrote stays. Outcome, fingerprint and commit can stay equal while
the state's origin, observed revision and key change, and `producingResult`
checked only the first three.

## The fix

`producingResult` (`src/core/state/producers.ts`) now also requires the named
row to be:

- at the failure key the sink recorded for the check (`failure-keys:<worktree>`,
  `recordFailureKeys`). Every sink that writes states keeps that row, the
  0.1.195 one included, in the same transaction as the state. A missing key
  reads unknown;
- from the state's origin: an inherited state's source worktree, or for an own
  state this worktree at the revision it was observed at (`observedAt` is the
  result's own revision for an own state, `stateFromResult`).

The inherited bound by `observedSince` that `shownResult` uses is deliberately
not applied: round 2 dropped it for the producer read (a valid inheritance can
be recorded after the receiver's revision began).

The 001-419 notes' claim that the outcome/fingerprint/commit match guards the
mixed-writer case is wrong; the key and origin checks do (that file belongs to
001-419 and is left as is).

## Regression

`test/status/failure-age.test.ts`, "a producer reference left by an older
writer (001-420)". The older writer is simulated by the current sink with the
producer row restored after each write, which is exactly what the 0.1.195
sink leaves: it records failure keys but not producers. Cases:

- the reviewer's: an inherited failure, then the older writer applies an own
  failure at a new key `k2`, revision 2, same fingerprint and commit: unknown;
- the same source's later failure inherited at `k2` by the older writer, the
  old `k1` row still stored: unknown (origin alone would not catch it; the key
  does);
- positive: a producer-aware refresh at `k2` names the new run.

The `seeded()` fixture now records the failure key with the producer, as the
sink does.
