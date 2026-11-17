# 005-104: can the per-session view stop being a copy of every state

Researcher of row 005-104 (task 4a1288e6), 2026-11-17, 10:15Z to 10:55Z. Brief: `consumer-view-design-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `status.md` (2026-11-17 entries), `session-start-cost.md` (005-101). Source: `47bd57f1c` (0.1.541). Stores: the view's tables of `~/projects/cezar/.git/squeal/store.sqlite` and `~/projects/squeal/.git/squeal/store.sqlite`, copied 10:30Z from read-only connections into the task's scratch directory (005-101's copies were gone). Probes: `probes/consumer-view-design/` (throwaway, README there). SQLite 3.54.0 (Node 26.13.0). Load: the host's own, 1-minute average 9.6 to 13.0 on 24 vCPUs, stated per group; none made on purpose.

**Verdict.** Yes. Seed the view with the states that are not `pass` only, and keep a birth mark for every known state. A check with no view row that was born before the consumer registered reads as the pass it was then. This design told the same entries as today's copy, and held the same view, in 100,000 random runs of the real `planDelta`. The registration then writes 21 rows instead of 35,086 (cezar). The win over 005-103's one-statement copy is small for the registration (32 to 12 ms). It is larger for every delivery: its SQL reads fall from 245 to 162 ms (cezar), because each tool boundary reads the whole view today. No rule changes.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Rules that read or write the view | 16 rules, table in section 1. Only `planDelta` and the waiter's `untold` read rows that are not failures. Stop and the late state read only told failures | read in source code and tests |
| 2 | Designs against the rules | The copy, copy-on-write with a change sequence, and the non-pass seed with a birth mark hold every rule. Both log-position designs and both watermark designs without copy-on-write break rules (section 2) | verified by experiment (`sim.ts`, 100,000 runs, seed 11) |
| 3 | Cost per design, SQL on copies, median of 15 | Registration write, cezar: 242 ms now, 32 ms as 005-103, 12 ms with the non-pass seed, 0.01 ms for copy-on-write. Delivery reads: 245, 162 and 172 ms. Copy-on-write moves the copy into the daemon's state commits: a full rewrite takes 1.48 s with one session instead of 0.23 s (section 3) | verified by experiment |
| 4 | Migration | A consumer with no mark keeps today's full view and today's reading. New marks start when a daemon of the new release makes the trigger and fills the marks (0.39 s for cezar's 968,615 states). An earlier release that delivers to a new consumer never repeats or loses a failure. It can miss a PASS -> UNKNOWN and word a PASS -> FAIL as first observed (section 4) | verified by experiment (sim, backfill); the release mix inferred |

## 1. The rules that depend on the view

Spec lines are 001 D6 unless named. "Needs" says what each rule reads from the view.

| # | Rule | Spec | Code | Test | Needs |
|---|---|---|---|---|---|
| R1 | A pass never told is written into the view silently | "A pass never told to anyone is written into the view silently" | `delta.ts` `planDelta` (`before === null`) | `delivery.test.ts` "writes a pass never told…" | whether a check was ever told |
| R2 | `beforeFailing`: a failure after an untold pass reads PASS -> FAIL, otherwise first observed; 001-101 walks a crash | transitions paragraph; goal 3 | `delta.ts` `beforeFailing` | "reads the change from the prior known state…", "keeps a failure with no prior known state first observed", 001-101 case | no row means never told |
| R3 | A changed failure is told | `fail -> fail` with a changed fingerprint | `transitionKind` against the row's fingerprint | `it.each` "fail-changed" | the told fingerprint |
| R4 | Failures known at registration are told once, in the registration | "On registration the view is seeded with the current known state of every check" | `registerNow` | "reports pre-existing and inherited failures once" | told failures |
| R5 | A retired check told as a failure is told once as no longer reported; told passes leave silently | "A check retired while the last state told…" | `planDelta` leftover rows; `sink.retire` | three "retired" tests | rows with no state |
| R6 | Broke and recovered between deliveries: nothing; a skipped failure back unchanged: nothing | "A check that broke and recovered…" | `planDelta` writes only notable kinds | "stays silent when a check breaks and recovers…", "…skipped and comes back unchanged" | the told state, not the last state |
| R7 | Own edit PASS -> UNKNOWN is not told; the view keeps PASS | task 001-220 | `own-edit.ts`, `planDelta` `continue` | `own-edit-unknown.test.ts` | told pass |
| R8 | Inherited and imported origins named | D6, 018 D4 | `originNames` reads the state | "names the root…" | nothing |
| R9 | Re-registration drops the earlier view; a new failure in it ends the late state | `consumers.register`; review 0.1.538 B1 | `registerNow`, `reportsNewFailure` | "re-seeds the view…", `late-paths.test.ts` | told failures |
| R10 | Unregister and expiry park the registration revision 12 h, not the view | D6 "parks it for 12 hours" | `unregister` deletes rows | "unregister drops the consumer and its view" | nothing |
| R11 | Late state and own count | 005-93, 005-97, 005-100 | `editTold` reads delta entries; R9 | `late-paths.test.ts` | the entries (R1 to R7) |
| R12 | Peek tells regressions only; the rest stays for the next boundary | D9 | `restrictPlan` | "consumes regressions only…" | rows of kept entries only |
| R13 | Stop holds for a required failure not told | 019 D4 | `untoldFailures` (`stop-required.ts`), `endTurn` | `stop-slow-untold.test.ts` | told failures |
| R14 | The waiter reads only owed files and never-told states | task 001-414 | `owedScope`, `knownStates.untold` | `idle-scope.test.ts` | whether a check was ever told |
| R15 | Pruning keeps check ids a view names; a removed worktree's rows go | D8 | `prune.ts:125`, `worktrees.ts` table list | `prune.test.ts` | row existence |
| R16 | `status --wait` news since its start | 011 C6 | `status-wait-held.ts`: a view in memory | `test/cli/kept-header.test.ts` | nothing stored |

## 2. Designs against the rules

`sim.ts` applies random writes (new outcome, rewrite of the same outcome, retirement), registrations, deliveries and peeks for 3 checks and 2 consumers, and logs transitions as `sink.ts` does. Each design gives `planDelta` its view; the copy is the reference.

| Design | Registration writes | Runs that tell other entries (of 100,000) | Rules broken, with the agent-visible case |
|---|---|---|---|
| C. Copy (today; 005-103 the same rows) | every state | reference | none |
| A. Transitions-log position; rows only when told | one mark | 7,363 | R5: a known failure retired before the next delivery is never told as no longer reported (2,388 deliveries). R2, R6: a check passing at registration that is skipped and then fails reads PASS -> FAIL where the copy says first observed (1,705). A check first seen after registration that passes and goes unknown before any delivery gets a PASS -> UNKNOWN the copy never says (1,361) |
| A+. A, with non-pass states seeded | non-pass rows | 2,316 | R1, R6: the same spurious PASS -> UNKNOWN (749). R2: PASS -> FAIL and first observed swapped through a skip (682 and 272) |
| B. Change sequence per state, watermark per consumer; rows only when told | one mark | 21,431 | R4: a known failure whose row is rewritten (same outcome, new validity) is told again as first observed (1,362). R3: a changed failure is told first observed (682). R5 and the recoveries and unknowns of checks known at registration are lost (7,502 FAIL -> PASS, 5,872 FAIL -> UNKNOWN, 3,619 PASS -> UNKNOWN) |
| B+. B, with non-pass states seeded | non-pass rows | 3,891 | R1: a pass at registration that goes unknown: PASS -> UNKNOWN lost (3,619). R2: PASS -> FAIL told first observed (340) |
| B-cow. B, plus copy-on-write: before a state is rewritten or deleted, a trigger copies its old row into the view of each consumer registered after its last change that has no row | one mark | **0** | none |
| N. Non-pass seed plus a birth mark per state; no row and born before the consumer's mark reads `pass` | non-pass rows and a mark | **0** | none |

**Why the log cannot be the starting point.** The log records only notable kinds (`sink.ts` `commit`, `transitionKind`). First passes, `unknown -> pass`, any change to `skip`, and retirements are not logged. So the log cannot say what a check was at the registration. It is an audit of news, not a history of states. *Read in source code; the cases verified by experiment.*

**Why N holds.** Every `pass` has a null fingerprint (`stateFromResult`, `setupOutcome`). A check that existed at the registration and has no row was a pass then. No delivery has told it anything since, because every write that `planDelta` makes adds a row. That is the row the copy holds. A check born after the registration has no row in the copy either. `sink.retire` removes told non-failures in both. Readers that need only told failures (R4, R9, R11, R13) read the rows as they are now. Only `planDelta` and `untold` (R1, R2, R14) must treat "no row, born before the mark" as a told pass. *Inferred from source; agrees with the 0 of 100,000.*

**A trap the birth mark must avoid.** Every `known_states` writer uses `INSERT OR REPLACE`. SQLite: "if an ON CONFLICT clause is specified as part of the statement causing the trigger to fire, then conflict handling policy of the outer statement is used instead" (CREATE TRIGGER page). So a trigger's `INSERT OR IGNORE` into the mark table becomes REPLACE and gives a new mark on every rewrite. `trigger-conflict.mjs`: mark 1 -> 4 under `OR IGNORE`, kept under `ON CONFLICT DO NOTHING` and under `WHERE NOT EXISTS`. The REPLACE's own delete fires no delete trigger while recursive triggers are off (conflict page). That is SQLite's default, and Squeal never sets it. The mark table needs `AUTOINCREMENT`: without it SQLite may reuse the id of a deleted largest row (autoinc page). *Verified by experiment; read in official docs.*

## 3. Measurements

`measure.mjs`, 15 runs per row, every write rolled back. Subjects: cezar `ed709f5d` (35,086 states, 21 not pass), squeal `db0382bd` (17,393, 24). Median / p90 ms, second series after the trigger fix.

| Step | cezar | squeal | load |
|---|---|---|---|
| Registration read of states with checks (same in every design; the header needs it) | 173 / 191 | 65 / 89 | 10.2, 10.8 |
| Registration write: copy, 3 statements per state (now) | 242 / 257 | 107 / 115 | 10.3, 10.8 |
| Registration write: copy, one `INSERT … SELECT` (005-103) | 32.1 / 34.1 | 13.5 / 13.9 | |
| Registration write: N (non-pass seed and mark) | 11.8 / 12.2 | 5.4 / 6.0 | |
| Registration write: B-cow (mark only) | 0.01 / 0.02 | 0.02 / 0.07 | |
| Re-registration: drop the earlier view, full / non-pass | 13.7 / 0.02 | 4.9 / 0.02 | |
| Delivery reads: copy (states and full view) | 245 / 308 | 105 / 118 | 10.2, 11.0 |
| Delivery reads: N (states, non-pass view, states born after the mark) | 162 / 221 | 62 / 65 | 11.9, 11.0 |
| Delivery reads: B-cow (states with change sequence, sparse view) | 172 / 186 | 69 / 78 | 12.4, 11.0 |
| State commit, 1,000 states rewritten: now / N / B-cow 1 session / B-cow 8 sessions | 5.5 / 6.7 / 12.9 / 85.6 | 7.4 / 8.0 / 14.0 / 96.9 | 12.4, 11.0 |
| State commit, every state rewritten: now / N / B-cow 1 / B-cow 8 | 225 / 265 / 1,484 / 3,662 | 114 / 134 / 710 / 1,788 | 10.7 to 12.4 |
| One-time fill of birth marks for the whole store | 386 / 510 (968,615 states) | 135 / 147 (319,153) | 9.8, 10.7 |

B-cow rows are its worst case: every first rewrite after a registration copies. Over a session it writes at most what the copy writes now, but inside the daemon's commits, which hold the store's write lock. The first series used `OR IGNORE` in the triggers: a full rewrite with N took 1,188 ms there. That made the trap visible.

**Field shape.** In both stores 99.9% of states are passes. Non-pass states per worktree: mean 26, maximum 372 (cezar); mean 192, maximum 4,400 (squeal, a worktree left unknown). The largest to-unknown burst in one revision was 13,178 (cezar). N's seed is that size in such a worktree: smaller than the copy, never larger. Today `consumer_views` holds 62,811 rows (cezar, 3 sessions) and 88,886 (squeal, 6). 47 and 112 of them are not passes. *Verified by experiment.*

## 4. Migration

- **Store (011).** One table `state_born (id INTEGER PRIMARY KEY AUTOINCREMENT, worktree_id, check_id, UNIQUE (worktree_id, check_id))`. An `AFTER INSERT` trigger on `known_states` inserts with `ON CONFLICT DO NOTHING`; an `AFTER DELETE` trigger removes the row. These are made as `ensureWriteMarkers` makes its triggers (`write-markers.ts`): `IF NOT EXISTS`, outside `schema.ts`, with no `user_version` raise, filled in the same transaction. So the writers of every release, an earlier daemon or a removed worktree's prune included, keep the marks right. A raise would make earlier releases refuse the store (`open.ts:144`). *Read in source code.*
- **Consumer mark (005).** One `meta` row per consumer, written by `registerNow`, removed by `drop` and expiry with the consumer's other told marks. A new-release hook writes it only while the triggers exist (read as `armed` reads them). Otherwise it seeds the full copy as 005-103 does. *Inferred.*
- **Live sessions at the upgrade.** A consumer with no mark is read as today: no row means never told. Its full view stays until its next registration (resume, compact, subagent start) or its expiry. Nothing is told twice and nothing is lost. *Verified by the copy design in `sim.ts`; the reading rule inferred.*
- **An earlier release that delivers to a consumer the new release registered** (a plugin or daemon version change mid-session): it reads absent passes as never told. `sim.ts`: 2,596 of 100,000 runs differ. PASS -> UNKNOWN is not told (2,256 deliveries), and a PASS -> FAIL through a skip reads first observed (340). No failure is told twice or lost, because failures are seeded. *Verified by experiment; how often the mix happens is not determined.*
- **Downgrade.** An earlier release registers with the full copy; its triggers' marks stay right. *Inferred.*

## Recommendation for Squeal

Build design N after 005-103, as one row with two owners: 011 store (the table, the two triggers in the write-marker manner, the fill, `untold`'s condition, the removed-worktree table list) and 005 delivery (the seed, the consumer mark, `planDelta`'s view with "born before the mark reads pass"). Amend 001 D6's sentence "On registration the view is seeded with the current known state of every check" to say that the view holds what was told plus the non-pass states at registration, and that a check with no entry which existed then reads as the pass it was. The agent sees no change in what it is told.

The tradeoff: about 20 ms (cezar) and 8 ms (squeal) more off each registration after 005-103, 14 ms off a re-registration, and 80 ms and 43 ms of SQL off every delivery. That costs a table, two triggers and one reading rule in two readers. A full state rewrite costs 18% more (225 to 265 ms). B-cow is rejected: it keeps every rule, but its state commits cost 2 to 16 times more and land on the daemon's write lock. A and B are rejected for the breaks above.

Risk: the mixed-release window in section 4. A new reader of the view that does not treat "born before the mark" as a told pass would reintroduce A+'s and B+'s breaks. `sim.ts`'s equivalence check is the test to keep for that.

## Open questions

1. The delivery's JS cost: decoding 35,086 view rows and building `planDelta`'s map is not measured. The saving is likely larger than the SQL's 80 ms. Not determined, because no hook code ran on the copies.
2. How often an earlier release delivers to a consumer a newer one registered: not determined. No store records the release of each delivery.
3. The registration's remaining cost is the states read (173 ms cezar), which the header and known failures need in every design. 005-101's summary row (its candidate 8) is the lever there, not the view.
4. `sim.ts` models 3 checks, 2 consumers and one worktree. It models inherited results as writes, validity changes as rewrites, and the own edit as a flag. It is a model check, not a proof.
5. The code and lint stores already seed failures only (`code-deliver.ts` `seed`, "a function with no entry reads pass"; `lint/surface/deliver.ts` `seedEntries`). How they tell a check new since the registration from an old pass was not analyzed.

## Sources

- SQLite, fetched 2026-11-17: CREATE TRIGGER, https://www.sqlite.org/lang_createtrigger.html (outer conflict policy); ON CONFLICT, https://www.sqlite.org/lang_conflict.html (REPLACE and delete triggers); UPSERT, https://www.sqlite.org/lang_upsert.html; AUTOINCREMENT, https://www.sqlite.org/autoinc.html.
- Squeal at `47bd57f1c`: `src/core/delivery/delta.ts`, `delivery.ts` (`registerNow`, `deliver`, `reportsNewFailure`), `own-edit.ts`, `turn.ts` (`owedScope`), `code-deliver.ts:137`; `src/core/lint/surface/deliver.ts:72`; `src/core/state/sink.ts`, `transitions.ts`, `derive.ts`; `src/core/store/schema.ts`, `repos/consumers.ts`, `repos/states.ts`, `write-markers.ts`, `prune.ts`, `open.ts`; `src/harness/shared/stop-required.ts`, `stop-slow.ts`; `src/cli/status-wait-held.ts`; tests named in section 1.
- Spec 001 D6 and D8; `session-start-cost.md` (005-101).
- Store copies and probe outputs in the task's scratch directory, not kept.
