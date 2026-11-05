# 011-295 notes: daemon presence, the accidental differences

Worker a4cd541d, 2026-11-05. Brief: `tasks/wave-70.md` W1. Design: `research/daemon-presence.md` ("Accidental differences", decision 3 as amended 2026-11-05). Terms: `GLOSSARY.md`. Base: main at 45eb4b8a1 (0.1.404).

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

Since row 011-293 each of the four readers takes its heartbeat reading from presence's one rule (`heartbeatFresh`, `heartbeatLateBy`, `heartbeatGraceMs`, `beatBetween`, `daemonLiveness`, `claimLiveness`, `lastHeartbeat`). None reads `heartbeatAt` itself (grep of the five files). What differs is what they print. Kinds: **agrees**; **deliberate** (a rule or a fact the reader has and status has not); **fixed**; **kept** (consistency would change a protected decision or test, or needs a read the row may not add; sent to the coordinator 2026-11-05).

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
| heartbeat late on both samples | serving, `hung: its heartbeat is N old on both samples, past two intervals` | kept: the words differ from status's "heartbeat late: the last one was N ago, at T; the daemon may be busy or stopped"; `test/ps/flags-daemons.test.ts:445` pins them |
| stopping, its heartbeat current (shutdown begun) | serving | kept: phase `stopping` would end `hung` and the past-idle and past-unused flags for it (they read `serving`) |
| stopping, the record cleared, a live claim | stopping | agrees |
| the record cleared, no claim, the lock still held | stopping | deliberate: status reads no lock once the record is cleared (review 0.1.259); ps sees the holder |
| starting (a start mark) | starting | agrees |
| a daemon holds the lock, the worktree has no row yet | starting | deliberate: status cannot find the lock without the row (`lockFileFor(row.commonDir, …)`) |
| a loser waiting for the lock | waiting | deliberate: status names no loser |
| no lock state (macOS) and a late heartbeat | unknown | deliberate: ps cannot tell |

### Hook spawn (`harness/shared/ensure.ts`): no change

`ensure` prints nothing. Its result reaches text in two places: a registration after `spawned` says "A daemon is starting" (the told start), and a boundary after `unavailable` adds the "Not validated" line (`deliver.ts` `notValidated`, `presence` `editLineView`, `format.ts` `notValidatedLine`).

| Presence, as status says it | Hook text | Kind |
|---|---|---|
| heartbeat late, its socket unresponsive | Not validated: the daemon's heartbeat is late: … | agrees (`lateHeartbeatDetail`) |
| gone, no CLI | Not validated: no daemon has validated since T | agrees |
| no row | Not validated: no daemon is running | agrees |
| stopped by request | none (`stopped`) | agrees: the header says the stop |
| a start current (marks) | none (`spawned`), then "A daemon is starting" | agrees |
| after a spawn beside a stale record | "A daemon is starting" (told start) | deliberate: status reads a late heartbeat (F4); the hook knows it spawned (task 001-156) |
| the last one died, no CLI to spawn (a plugin path gone) | Not validated: the daemon's heartbeat is late … until it validates again | kept: status says it died and names `squeal start`; the edit line would need a lock probe, which row 011-293 kept out of the hook's edit path |
| stopping, its socket unresponsive | Not validated: no daemon has validated since T | kept: status says stopping; the same probe |

### The open-run claim (`status/open-runs.ts`): no change

It prints nothing itself. Status words the claim ("waiting for <worktree>'s run of its key, at most until T", `next-step.ts`), and its rule is the heartbeat's: `claimed(…, claimLiveness(now))` and `heartbeatFresh` for the claimant, `liveStartedAt` from status's `DaemonLiveness` for the open runs. A claimant whose shutdown began still claims (its heartbeat is current); status of that worktree says stopping. Deliberate: whether a claim holds is a protected decision.

## Spec sentences to amend (the coordinator edits the spec)

C5, the header paragraph. Today: "Every delivered message carries a header: daemon liveness when no daemon is validating (since when, and that results are as of the last revision it reached), delivered once per consumer when it changes, and, in every header while it lasts, a late change feed (C6, row 011-200), which starts no delivery of its own; …". Proposed:

> Every delivered message carries a header: daemon liveness when no daemon is validating (since when, and that results are as of the last revision it reached), delivered once per consumer when its presence state, or a note the header says with it, changes (amended 2026-11-05, row 011-295: a late heartbeat, a death, a stop by request, a stopping daemon and no daemon are each told once, as the header words them); a start and a rest are no news, nor a daemon whose heartbeat still says validating while it stops; and, in every header while it lasts, a late change feed (C6, row 011-200), which starts no delivery of its own; …

C8, the Stop news rule of 2026-10-25. Append:

> Amended 2026-11-05 (row 011-295): a change between two states of a daemon that does not validate (a late heartbeat that ends in a death or an exit, a stop by request after either, a handoff that ends with no successor) is a liveness change too (C5). At Stop each is a daemon down with no successor, so it is news there.

C8 or C7, where the told liveness is kept (001's D6 calls it "the told liveness"): the told value now holds the presence state and notes (`{ state, notes, short? }`); a hook of a release before row 011-295 reads it as `alive`, or `{ short }`, and tells a state that does not validate once more.

## Decisions the spec did not settle

1. **The told value's form.** One new object, `ToldPresence`, for every value news or a registration tells; `{ startingSince }` stays for the registration's told start. The previous release's forms are read, never written. A previous release reads a validating value right and any other as `alive` (the precedent of `{ startingSince }` and `{ short }`, "a hook before either reads the object as alive").
2. **Stopping with a current heartbeat.** Not news (the coordinator's reply "A", 2026-11-05).
3. **A note that ends is not news.** The header says nothing when a note ends.
4. **A death beside a stop is no news of its own**, and a stop beside a death holds no death note: the header and status's text say only the stop there.
5. **News reads the death only where it may tell it**: not beside a stop, a told start or a locked start mark.

## Type changes

- New: `ToldPresence`, `readTold`, `alreadyTold` (`presence/told.ts`, exported from presence).
- `ToldLiveness` moved to `presence/told.ts` and gains `ToldPresence`; its other members are unchanged.
- `toldOf(live)` returns `ToldPresence` (was `ToldLiveness`: `alive`, `down` or `{ short }`).
- `toldLiveness` (`delivery/liveness.ts`) reads through `readTold`; its signature is unchanged.

## Checks

See the commit messages and the final report for the commands and results.

## For the next worker

- The three kept reader cases wait for the coordinator.
- `presenceState` (`state.ts`) is still read by no view; news uses `toldOf` over the delivered liveness, since the header's words differ from `presenceState` in two places: the death note beside a stop, and a current heartbeat while it stops.
