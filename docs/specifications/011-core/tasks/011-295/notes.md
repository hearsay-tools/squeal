# 011-295 notes: daemon presence, the accidental differences

Worker a4cd541d, 2026-11-05 (news, `start`, the reader survey); worker f1255917, 2026-11-05 (the hook's line, the kept cases, the claim, the done-when). Brief: `tasks/wave-70.md` W1. Design: `research/daemon-presence.md` ("Accidental differences", decision 3 as amended 2026-11-05). Terms: `GLOSSARY.md`. Base: main at 45eb4b8a1 (0.1.404).

## News

### The rule

News tells the presence state the header tells, and the notes the header says with it, once per consumer, when they are not what the consumer was told. Four rules stay beside it in `presence/views.ts`, each deliberate:

| Rule | Source |
|---|---|
| A late change feed is no news. | C5 (row 011-200) |
| A start is no news, nor the first heartbeat after a told start. | task 001-156, row 011-251 |
| A rest is no news; an overdue rest is forgotten, then told as no daemon. | D10 as amended, task 001-415 |
| A daemon whose heartbeat is current is validating for news, its shutdown begun or not. Its stop is news once its heartbeat lapses or its record is cleared. | the coordinator, 2026-11-05 (reply to this row's request: "A") |

A note that ends while the state stays is not news: the header says nothing then.

The header words a death only beside a start or beside no daemon (`delivery/header.ts`, `livenessSentence`); beside a stop, a stopping daemon or a late heartbeat it says only the state. Status's text does the same (`status-detail.ts` `daemonLine`, `outstanding-text.ts` `daemonText`). So a told stop beside a death holds no death note, and a death that comes beside a held stop is no news of its own. Status's JSON keeps naming both (decision 3 as amended; `presenceState` names the note).

### What a consumer was told

`presence/told.ts` (new):

- `ToldPresence`: `{ state: PresenceState, notes: PresenceNote[], short?: string }`, what `toldOf(live)` makes of the delivered liveness in the header's words. `short` names the short handoff's daemon (row 011-140).
- `ToldLiveness` (moved from `views.ts`): `ToldPresence`, `{ startingSince }` (a registration's told start, unchanged), and the previous release's forms `alive`, `down` and `{ short }`.
- `readTold(value)`: the stored value. The previous release's forms read as that release read them.
- `alreadyTold(told, now)`: whether `told` already said `now`. For `ToldPresence`: the same state, every note of `now` in `told`, and the same short daemon. For a previous release's value: `down` already said every state that does not validate; `alive`, `{ startingSince }` and `{ short }` said validating, except a short handoff they did not name (the 0.1.404 rule).

Stored bytes in `liveness-told:<worktree>` per consumer: `{"state":"heartbeat late","notes":[]}`, `{"state":"validating","notes":["handoff ended short"],"short":"0.1.400@…#tok"}`, and so on. The row's key and `writeSlot` are unchanged.

Across releases (`test/presence/told.test.ts`, with 0.1.404's reader and news rule copied verbatim from 45eb4b8a1):

- A value 0.1.404 stored (`alive`, `down`, `{ short }`, `{ startingSince }`, none, an unknown object) reads as 0.1.404 read it, and gives news exactly where 0.1.404 gave it, for every presence state.
- 0.1.404 reads every value this release stores without error: a validating one as `alive` (or `{ short }`), any other as `alive`. So a 0.1.404 hook beside a 0.1.405 one tells a state that does not validate once more, then stores `down`, which this release reads as before.

### Transitions that are news now

With a value this release told. Each was no news before, since both sides read `down`:

| Told | Now | Title (the header's words) |
|---|---|---|
| heartbeat late | gone, the last one died (the lock freed) | no daemon is validating; the header names the death |
| heartbeat late | gone (the busy daemon exited and cleared its record) | no daemon is validating |
| gone, the last one died | heartbeat late (a later daemon, missed while it validated) | the daemon's heartbeat is late |
| stopping | gone (a claim past its bound, a lock freed) | no daemon is validating |
| stopping, heartbeat late or gone | stopped by request | the daemon is stopped by request |
| resting (told at a registration) | gone (the rest's spawn overdue) | no daemon is validating |

One rare sequence gains a message: a consumer told a state that does not validate (a death or a stop, beside a record left stale), then a hook spawns a daemon at the next boundary. While the new daemon has not yet taken the lock, status reads a spawn mark beside a stale record as a late heartbeat (row 011-251, F4), so news says "the daemon's heartbeat is late" once, then "validating again" once it registers. Before, both sides read `down`. The header says the same at that moment. The usual death (told validating, then killed) is unchanged: the hook spawns before it delivers, and news said "heartbeat late" then too.

### The news view

`newsView` adds, beside a record whose shutdown never began, with no told start, no locked start mark and no stop: the death (`Presence.died`), else the late heartbeat (`withLateHeartbeat`). They are asked after the marks, so a start probes no lock. The change it returns is the header's liveness for those cases (`delta.liveness` gains `died` or `heartbeatLate`); `toldOf` maps it to the told value.

### Reads (`test/presence/reads.test.ts`)

Three news lists change, each by the read the new text needs:

| Row | Was | Now |
|---|---|---|
| another incarnation's exit mark, its lock held | `told row .starting .spawned stop exit notes` | `… notes probe` |
| a late heartbeat, its lock held | `told row .starting .spawned stop exit notes` | `… notes probe` |
| a death: a stale record, no shutdown, its lock free | `told row .starting .spawned stop exit notes` | `… notes probe in-flight` |

"A spawn mark beside a stale record, its lock held" reads nothing new: its marks rule out a death before the probe. No other list changed.

### Tests changed

- `test/presence/rows.ts`: four rows lose their `news` override (`news: stale`). Their news is status's view now: the late heartbeat or the death.
- `test/presence/presence.test.ts`: each row's news, told again, is no news (`toldOf`). The rows' told values are 0.1.404's, so the default oracle (alive or down) is the "reads as today" proof.
- `test/delivery/liveness.test.ts` "is in every registration and delta header": `delta.liveness` equals the header's daemon (the late heartbeat).
- New: `test/presence/news.test.ts` (a late heartbeat, then the death, each once per consumer, worded as the header words them; a late change feed starts no delivery) and `test/presence/told.test.ts`.

## Readers

Since row 011-293 each of the four readers takes its heartbeat reading from presence's one rule (`heartbeatFresh`, `heartbeatLateBy`, `heartbeatGraceMs`, `beatBetween`, `daemonLiveness`, `claimLiveness`, `lastHeartbeat`). None reads `heartbeatAt` itself (grep of the five files). What differs is what they print. Kinds: **agrees**; **deliberate** (a rule or a fact the reader has and status has not); **fixed**; **kept** (a difference the human or the coordinator decided to keep, 2026-11-05).

### `squeal start` (`cli/start.ts`): fixed

`start` prints one line, then status. Cases for the line:

| Presence, as the status below says it | Line before | Line now | Kind |
|---|---|---|---|
| validating | Squeal daemon alive / spawned | the same | agrees |
| a daemon answers its socket before the store records it | Squeal daemon alive | Squeal daemon answered | fixed |
| a daemon answers while its heartbeat is late (a busy store) | Squeal daemon alive | Squeal daemon answered | fixed |
| a daemon `start` spawned answered, not recorded by the bound | Squeal daemon spawned | the same ("a daemon is starting" below) | agrees |
| stopping | (never: `finishHandoff` runs) | | agrees |
| the successor after a handoff | Squeal daemon started …, after the X daemon handed over | the same, recorded first (`follows`) | agrees |
| exit 3: a spawned daemon has not answered in 30 s | "is still starting" (stderr) | the same | deliberate: with a stale record, status reads its spawn mark as a late heartbeat (F4); `start` knows it spawned |

`startedWord` (in `start.ts`): `alive` only while status says the daemon validates and is not stopping; a busy store (status unavailable) keeps the result's word. `test/daemon/handover-tier.test.ts:208` already stated the rule ("`start` never printed alive above a snapshot that said no daemon"). Test: `test/daemon/start-answered.test.ts`. No spawn, wait or exit code changed; the existing start tests are unchanged.

### `squeal ps` (`ps/flags.ts`, `ps/discover.ts`, `ps/render.ts`): no change

`ps` reads a process (its lock, `/proc/locks`, its row), status a worktree's store and marks. Its presence words are the phase column and the `hung` flag.

| Presence, as status says it | ps says | Kind |
|---|---|---|
| validating | serving | agrees |
| heartbeat late on one sample | serving, no flag | deliberate: the two-sample rule |
| heartbeat late on both samples | serving, `hung: its heartbeat is N old on both samples, past two intervals` | kept as deliberate (the coordinator, 2026-11-05): the words name the two-sample rule, which status does not apply; status says "heartbeat late: the last one was N ago, at T; the daemon may be busy or stopped". `test/ps/flags-daemons.test.ts:445` is unchanged |
| stopping, its heartbeat current (shutdown begun) | serving | kept (the human, 2026-11-05: "Keep as is"): status says stopping; phase `stopping` would end `hung` and the past-idle and past-unused flags for it, which read `serving` |
| stopping, the record cleared, a live claim | stopping | agrees |
| the record cleared, no claim, the lock still held | stopping | deliberate: status reads no lock once the record is cleared (review 0.1.259); ps sees the holder |
| starting (a start mark) | starting | agrees |
| a daemon holds the lock, the worktree has no row yet | starting | deliberate: status cannot find the lock without the row (`lockFileFor(row.commonDir, …)`) |
| a loser waiting for the lock | waiting | deliberate: status names no loser |
| no lock state (macOS) and a late heartbeat | unknown | deliberate: ps cannot tell |

### Hook spawn (`harness/shared/ensure.ts`, `deliver.ts`): the Not validated line fixed

`ensure` prints nothing, and no spawn decision changed. Its result reaches text in two places: a registration after `spawned` says "A daemon is starting" (the told start), and a boundary that may have edited, after `unavailable`, adds the "Not validated" line (`deliver.ts` `notValidated`, `presence` `editLineView` through `readEditLine`, `format.ts` `notValidatedLine`). `unavailable` means the hook could neither reach nor start a daemon: one holds the socket and does not answer in 100 ms, or there is no CLI to spawn (`daemon/ensure.ts`).

| Presence, as status says it | Hook text before | Hook text now | Kind |
|---|---|---|---|
| heartbeat late, its socket unresponsive | Not validated: the daemon's heartbeat is late: … | the same | agrees (`lateHeartbeatDetail`) |
| gone, no CLI | Not validated: no daemon has validated since T | the same | agrees |
| no row | Not validated: no daemon is running | the same | agrees |
| the last one died, no CLI to spawn (a plugin path gone) | Not validated: the daemon's heartbeat is late … until it validates again | Not validated: no daemon has validated since T; the last daemon died without shutting down, between runs (or during run …); `squeal start` starts one; any change this call made has no result. | fixed (status: "…; it died without shutting down, between runs; `squeal start` starts one") |
| stopping: its shutdown began, its heartbeat late, its lock held | Not validated: no daemon has validated since T | Not validated: the daemon is stopping since T; nothing validates until its lock frees; any change this call made has no result. | fixed (the header's and status's `stoppingText`) |
| stopping, past its bound | Not validated: no daemon has validated since T | … stopping since T, past its 130 s bound; `squeal start` finishes it; … | fixed |
| handing over: the record cleared, a live claim | Not validated: no daemon has validated since T | Not validated: the daemon is handing over from X to Y since T; Y serves once the old daemon's lock frees; … | fixed |
| stopping, its heartbeat current | none (`fresh`) | the same | agrees: no line while the heartbeat is current |
| stopped by request | none (`stopped`) | the same | agrees: the header says the stop |
| a start current (marks) | none (`spawned`), then "A daemon is starting" | the same | agrees |
| after a spawn beside a stale record | "A daemon is starting" (told start) | the same | deliberate: status reads a late heartbeat (F4); the hook knows it spawned (task 001-156) |

`editLineView` decides presence (`decidePresence`) and says, for a down heartbeat: the stopping daemon, else for a record no shutdown cleared its death, else its late heartbeat. It reads no stop and no start of its own: a hook that prints the line found neither (`ensure` returns `stopped` while a stop holds and `spawned` while a start is current). So the table's rows with a held stop or a current start keep an edit line that differs from status (`rows.ts`, `rows-stop.ts` name it); no hook prints it there. `presence.test.ts` checks the rest: every row where a hook prints the line (a down heartbeat, no held stop, no current start) has the status view as its edit line. Text test: `test/harness/not-validated.test.ts` (a death, a shutdown begun, past its bound, a handoff after the record was cleared; each beside status's text for the same store). The death's cause sentence (`DEATH_CAUSE`) is left out of the line, which repeats at every edit; the header says it once, with the death's news.

#### Reads of the edit line (`test/presence/reads.test.ts`, `io.test.ts`)

The hook reads the line only when it prints it: after an edit, when `ensure` returned `unavailable`, and the new reads come only after the heartbeat read says down. Only the `editLine` column changed. Each new read is the death or the stopping finding, read as status reads them:

| Rows | Was | Now | The new reads |
|---|---|---|---|
| a row whose record is cleared (20 rows: claims, starts, rests, stops, told starts, nothing else) | `row` | `row claim` | the claim: a handoff under way after the old daemon cleared its record (stopping) |
| a stale record, no shutdown, beside a spawn mark or no lock file (a spawn mark beside a stale record; the 4 stop rows beside a stale record) | `row exit notes` | `row exit notes .starting .spawned` | the marks: a spawn mark rules out the death, and with no lock file no probe is made |
| a start marked in place of a stale record (and its 2 stop rows) | `row exit notes` | `row exit notes .starting` | the start mark, which rules out the death |
| a late heartbeat, its lock held; another incarnation's exit mark | `row exit notes` | `row exit notes .starting .spawned probe` | the marks, then the lock probe (the death) |
| a death; a told start beside a death; a death while a stop holds | `row exit notes` | `row exit notes .starting .spawned probe in-flight` | the marks, the lock probe and the open runs (the death) |
| a stale heartbeat handing over, its lock held | `row exit notes` | `row exit notes .starting .spawned probe claim` | the marks, the lock probe and the claim (stopping) |
| a stop past its bound | `row exit` | `row exit .starting .spawned probe notes claim` | the marks, the lock probe, the exit note and the claim (stopping) |
| a shutdown whose lock is free | `row exit` | `row exit .starting .spawned probe` | the marks and the lock probe (stopping, which a free lock ends) |

`io.test.ts`: a stale record now reads `exit notes .starting .spawned` (was `exit notes`); one whose exit row names it reads `exit .starting .spawned notes claim` (was `exit`). A fresh heartbeat still reads nothing.

### The open-run claim (`status/open-runs.ts`): no change

It prints nothing itself, and says no presence. Status words the claim ("waiting for <worktree>'s run of its key, at most until T", `next-step.ts`, from `claimantOf` in `standing.ts` and `unknown-files.ts`; `status-wait-ask.ts` reads the claim for the wait), and its rule is the heartbeat's: `claimed(…, claimLiveness(now))` and `heartbeatFresh` for the claimant, `liveStartedAt` from status's `DaemonLiveness` for the open runs (`openRuns`, `openRunsOf`; `retry-queue.ts`, `holds.ts`).

| Presence of the claimant, as its status says it | Claim text | Kind |
|---|---|---|
| validating | waiting for X's run of its key, at most until T | agrees |
| stopping, its heartbeat current | the same | deliberate: the claim holds while the heartbeat is current (a protected decision); the text names a run and a bound, not the claimant's daemon, so it says nothing status contradicts |
| heartbeat late, gone, stopped | no claim; the file's own reason | agrees: no claimant names a daemon status says does not validate |
| this worktree's daemon down | no open runs (`liveStartedAt` is `null`) | agrees: status's own `DaemonLiveness` |

## Spec sentences to amend (the coordinator edits the spec)

C5, the header paragraph. Today: "Every delivered message carries a header: daemon liveness when no daemon is validating (since when, and that results are as of the last revision it reached), delivered once per consumer when it changes, and, in every header while it lasts, a late change feed (C6, row 011-200), which starts no delivery of its own; …". Proposed:

> Every delivered message carries a header: daemon liveness when no daemon is validating (since when, and that results are as of the last revision it reached), delivered once per consumer when its presence state, or a note the header says with it, changes (amended 2026-11-05, row 011-295: a late heartbeat, a death, a stop by request, a stopping daemon and no daemon are each told once, as the header words them); a start and a rest are no news, nor a daemon whose heartbeat still says validating while it stops; and, in every header while it lasts, a late change feed (C6, row 011-200), which starts no delivery of its own; …

C8, the Stop news rule of 2026-10-25. Append:

> Amended 2026-11-05 (row 011-295): a change between two states of a daemon that does not validate (a late heartbeat that ends in a death or an exit, a stop by request after either, a handoff that ends with no successor) is a liveness change too (C5). At Stop each is a daemon down with no successor, so it is news there.

Spec 001 D9 (and its copy in 012), the PostToolBatch sentence that quotes the line "Not validated: no daemon has validated since <time>; any change this call made has no result." ("no daemon is running" when none ever heartbeat). Append:

> Amended 2026-11-05 (row 011-295): the line says the daemon as status says it: "the daemon's heartbeat is late: …; any change this call made has no result until it validates again." (row 011-276); beside a daemon that died, "no daemon has validated since <time>; the last daemon died without shutting down, <between runs | during run …>; `squeal start` starts one; …"; beside a shutdown begun or a handoff under way, "the daemon is stopping since <time>; nothing validates until its lock frees; …" (or "handing over from X to Y since <time>; Y serves once the old daemon's lock frees", or past its bound "`squeal start` finishes it"). It reads the death and the stopping daemon only when it prints.

C8 or C7, where the told liveness is kept (001's D6 calls it "the told liveness"): the told value now holds the presence state and notes (`{ state, notes, short? }`); a hook of a release before row 011-295 reads it as `alive`, or `{ short }`, and tells a state that does not validate once more.

## Decisions the spec did not settle

1. **The told value's form.** One new object, `ToldPresence`, for every value news or a registration tells; `{ startingSince }` stays for the registration's told start. The previous release's forms are read, never written. A previous release reads a validating value right and any other as `alive` (the precedent of `{ startingSince }` and `{ short }`, "a hook before either reads the object as alive").
2. **Stopping with a current heartbeat.** Not news (the coordinator's reply "A", 2026-11-05).
3. **A note that ends is not news.** The header says nothing when a note ends.
4. **A death beside a stop is no news of its own**, and a stop beside a death holds no death note: the header and status's text say only the stop there.
5. **News reads the death only where it may tell it**: not beside a stop, a told start or a locked start mark.
6. **The Not validated line's words** (worker f1255917; the coordinator decided the line agrees with status, 2026-11-05). A death: the header's "the last daemon died without shutting down, …", then status's "`squeal start` starts one"; the death's cause sentence is left out, since the line repeats at every edit and the header says it once. A stopping daemon: the header's `stoppingText` (no age), as status's next step says it. A handoff after the record was cleared counts as a shutdown begun: status says it as stopping (`stoppingOf`, review 0.1.259), so the line does too, at the cost of one claim read when the record is cleared.
7. **The edit line reads no stop and no start.** A hook prints it only after `ensure` found neither, so the rows of the table with a held stop or a current start keep their old edit line; reading them would add the stop mark and the marks to every print for no case a hook reaches.

## Type changes

- New: `ToldPresence`, `readTold`, `alreadyTold` (`presence/told.ts`, exported from presence).
- `ToldLiveness` moved to `presence/told.ts` and gains `ToldPresence`; its other members are unchanged.
- `toldOf(live)` returns `ToldPresence` (was `ToldLiveness`: `alive`, `down` or `{ short }`).
- `toldLiveness` (`delivery/liveness.ts`) reads through `readTold`; its signature is unchanged.
- `notValidatedLine(daemon, command?)` (`delivery/format.ts`) gains an optional `command` (default `squeal`), which the death and a stopping daemon past its bound name. Additive.
- `editLineView(facts, at)` and `readEditLine` keep their signatures; the `DaemonLiveness` they return may now carry `died` or `stopping` (both existing members).

## Checks

At ebd965f86, host load 55 to 73 on 24 CPUs (other tasks' work), 2026-11-05:

- `pnpm run lint`, `pnpm run typecheck`: pass. No `pnpm run build` (the brief), so the four bundle checks (`plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`, `codex/packaging/runtime.test.ts`) fail on drift until a build.
- Squeal's affected checks of the changed sources, revision 12: 875 test files pass; 30 still pending at the last read; the four bundle checks fail; two timing failures, below.
- `test/commit/stop-told-daemon.test.ts`, both cases, failed in Squeal's tier of 148 files at 2.22 load per CPU: the boundary after a commit had no "Commit …; 1 test file still running" line. That boundary waits at most 500 ms for the daemon's pass (row 019-29) and asks for it only after `ensure` found the heartbeat fresh; this row changes neither (the new reads are on the `unavailable` path and on news for a heartbeat that is down). Run alone at this head, `node_modules/.bin/vitest run` of the file: 4 runs, 4 pass (2 tests each). Load.
- `test/harness/opencode-dispose.test.ts` "serve: an abort of the new turn, then the old Stop's answer, stores nothing" failed in Squeal and alone at this head (2 of 2: the held Stop killed at +2133 and +2034 ms, past its 2000 ms idle deadline), and fails the same way at main 45eb4b8a1 in a private copy (2 of 2: +2385, +2205 ms). Squeal records it flaky at the same inputs on 2026-11-04. Load, not this row.

## For the next worker

- Every reader case is settled: fixed, deliberate, or kept by a decision of 2026-11-05 (two `ps` cases). No request is open.
- `presenceState` (`state.ts`) is still read by no view; news uses `toldOf` over the delivered liveness, since the header's words differ from `presenceState` in two places: the death note beside a stop, and a current heartbeat while it stops.
