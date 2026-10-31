# Row 011-273: one rule for named waits

Recommendation: adopt one rule, "named demand", in option B (waits only, kept in the store) as the first slice. Option A extends it later to retries and named slow files. Four of the six items are cases of the rule. Two items need a split, because they are not about what a wait owns: gh-123's regex selection and gh-125's foreground handoff.

Researcher, row 011-273, 2026-10-31. Brief: `tasks/wave-60.md` R1. Worktree commit `b34b00682` (Squeal 0.1.379 source; scheduler unchanged since 0.1.378). Probe: `probes/011-273/` (`probe.test.ts`, output `result.txt`), run at load 21.4 to 23.0 on 24 CPUs, 5 of 5 passed. No product code changed.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | The rule in five sentences | Below, "The rule" | inferred from Q2 |
| 2 | Each item today and under the rule | gh-110, gh-116, gh-123 (cap), gh-127 and 011-266 S2 are cases; gh-123 (regex) and gh-125 (handoff) are not | each row tagged below |
| 3 | Options, effect, example, cost | A: all named requests. B: waits only, kept in the store. C: today's order, and status says why | inferred; sizes estimated from the files named |
| 4 | Rules and code it replaces | Six spec sentences, four code seams | read in source code and spec |
| 5 | C4/C15 sentences it changes | Listed below | read in spec |
| 6 | First slice's done-when | Six tests, below | inferred |

## The rule

1. **What it is.** A request that names test files by their own paths (`status --wait`, with or without `--check`; in option A also `retry <file>`) makes one batch of those files, and batches keep the order in which the requests came.
2. **What it owns.** A batch owns its files' place ahead of every file that no request named, in each lane its files are in, and the evidence they give at their current keys (a result or a focused outcome) while its request is open.
3. **For how long.** A file stays in its batch until it is current at its key, its key moved, or it left the queue. The store holds the batch, so a successor daemon takes it over with the files it re-queues. A request's deadline bounds only that request's wait.
4. **What it may overtake.** At a tier boundary a batch goes before later batches and every unnamed queued file, including the backlog, catch-up and (option A) the slow lane's wait for background fast work. It never cuts a running file of an earlier batch. An edit's tier runs beside it (Vitest) or counts with it (slots), and after each batch tier, a focused one included, the backlog gets one tier.
5. **What it never changes.** It never changes which files run, at which keys, or any verdict, and it never passes a claim, the load gate, a hold, the pool's grant or a step-down.

Sentences 2 to 5 are today's batch (rows 011-268 and 011-269) with three changes: the store holds it (sentence 3), a request owns its outcomes while open (sentence 2), and a request keeps its place before its files are queued (sentence 1, finding F1).

## Findings

**F1. A wait that comes before its file is queued owns nothing (verified by experiment, probe P1, 0.1.379 source).** A promotion for a file that is not yet queued forms no batch and is not kept. When the file is queued 5 s later, inside the wait's deadline, it is neither promoted nor in the first group (`{"late":{"promoted":false,"firstGroup":false}}`). The control, with the file already queued, gives `promoted: true`. Cause, read in source code: `Promotions.add` keeps a wait only when `open.length > 0` (`src/core/scheduler/promotions.ts`). The CLI sends its promotion once (`status-wait-paths.ts:308`). It re-sends only for files that the wait asked itself (row 011-207, line 322). A file that a `retry` request holds behind the load gate is not one of them, because the wait asks no file with a request already stored at its key (C15, row 011-207).

**F2. An explicit retry is second-group work (verified by experiment, P2; read in spec C5).** A forced retry of a failing file orders after an edit's file and is not first group (`["edited","retried","other"]`). C5 says "forced at the file's normal priority". With batches since 0.1.378, it also waits for every batch (P5: a batch 10 minutes past its deadline still goes first, `["named","retried"]`).

**F3. A successor ignores a batch row that is still in the store (verified by experiment, P3).** The predecessor's `promotions:<worktree>` row still holds `batch.files`. The successor's `publishedBatches` reads 0 entries, because `at < daemonStartedAt`. Its own queue orders `["a","b"]`, so B loses first place. Nothing deletes the row on a step-down (read in source code: only an empty batch list or `queue.clear()` on a reinstall clears it). `research/issue-116.md` showed the same loss on 0.1.370 with a simulated successor.

**F4. The focused row drops an open wait's outcomes (verified by experiment, P4).** `writeFocused` keeps 20 files. One wait's 24 runs lose `rows-01` to `rows-04`. `research/issue-123.md` F3 showed that such a wait then runs to its deadline and exits 3 (0.1.374).

**F5. A named slow file waits for unrelated fast work (read in source code, 0.1.379; verified by experiment on 0.1.365 in `004/research/issue-110.md`).** `SlowTier.#fastFirst` is `editPending() || (!requested && !fastIdle())`. Its only change since 0.1.365 is `da18c8487` (runtime policy identity), and `orderedBatches` excludes slow files. So a named slow file still waits until the fast backlog has drained, unless `run --slow` was asked.

**F6. A requested slow run starts beside a batch's tier (read in source code).** A batch's tier has kind `backlog` (`tiers.ts:425`), and `Scheduler.#editPending` excludes backlog tiers. So an explicit `run --slow` starts beside it, as review 0.1.377 S2 showed by fixture. Spec 004 D2 allows this beside backlog.

**F7. Both failed reviews were interactions with other rules, not the batch itself (read in reviews).** In 0.1.377 B1, a queued edit masked a later wait's yield and status claimed an open wait that had ended. In 0.1.378 B1, an edit's tier used the backlog's turn. 0.1.378-r2 N1 found a third case: a focused tier goes before the turn that is due. Every case asked which owner goes first at a boundary. The rule answers that question in one place (sentence 4).

## Each item, today and under the rule

| Item | Today (0.1.379) | Under the rule | Tag |
| --- | --- | --- | --- |
| gh-110 named slow file | Waits behind every unrelated fast tier (F5) | Option A: a named slow file opens the slow lane for itself, as `run --slow` does for the lane: it waits for an edit's work, not for the backlog. Option B: unchanged, and status says it waits for the fast backlog | read in source code; issue-110 experiment |
| gh-116 handover | The batch is lost and the active wait does not re-send it (F3) | The successor takes over each batch whose files it re-queues at the same key, and republishes it | verified by experiment (today); inferred (rule) |
| gh-123 cap | A wait over more than 20 files loses outcomes and times out (F4) | An open wait's files are never dropped from the row. The cap applies only to files that no open wait selected | verified by experiment (today); inferred (rule) |
| gh-123 regex | Substring only | **Split**: this is how files and checks are selected, not what a wait owns. Separate row | read in `issue-123.md` |
| gh-125 broad gate | Scheduling half shipped in 0.1.378 (one batch, longest first). `hold` neither bounds the command nor imports its result | Scheduling: as today, and it now survives a handover. **Split**: the foreground handoff is a hold, which sentence 5 keeps out | read in `issue-125.md`, `named-wait-batches.md` |
| gh-127 fast retry | Second group. A wait sent before the gate opens owns nothing (F1, F2) | Option A: the retry request is a batch, placed when the request came, and joins when the gate opens. Option B: a wait open when the gate opens holds the file (F1 fixed); a retry with no open wait stays second group | verified by experiment (today); inferred (rule) |
| 011-266 S2 | A requested slow run starts beside a batch tier (F6) | Kept: they are different lanes, and the pool's grant (C10) shares capacity between them. No named demand waits for a request in another lane | read in source code; inferred |
| 0.1.378-r2 N1 | A focused tier goes before a due post-batch turn | A focused tier is its wait's batch tier, so the turn follows it | read in review; inferred |

## Options

| Option | What a user sees | Example | Cost (inferred) |
| --- | --- | --- | --- |
| **A. All named requests** | `retry <file>` and a named slow file run at the next tier boundary. A batch survives a daemon upgrade. Waits over 20 `--check` files settle | #127: the retried file starts at the first boundary after load falls below the CPU count, not 8 minutes later. #110: the named e2e file starts while fast backlog remains | About 150 to 250 source lines in `promotions.ts`, `retries.ts`, `slow-tier.ts`, `handover.ts`/`bootstrap.ts`, `focused-row.ts`, plus 600 to 900 test lines. Highest risk: two new boundaries (retry gate, slow gate), which is the kind of interaction that failed review twice (F7). Slower: the backlog and catch-up by one batch per retry, and fast backlog while a named slow file runs beside it |
| **B. Waits only, kept in the store** (recommended first) | A wait keeps its place across a version upgrade and before its files are queued. Waits over 20 `--check` files settle. Retries and slow files keep today's order, and status says so | #116: the agent's wait after a step-down still leads the queue. #127 with a wait open when the gate opens: the file joins that wait's batch | About 60 to 100 source lines (`promotions.ts` add and takeover, `bootstrap.ts` import, `focused-row.ts` keep), plus about 300 test lines. Low risk: it touches no tier selection or yield rule. Slower: only unnamed work after a handover, by the inherited batch |
| **C. Today's order, status says why** | No faster results. Each pending line names its blocker: "promotion lost at the daemon's upgrade; wait again", "retry queued at normal priority behind N tiers", "slow: behind the fast backlog". `--check` above 20 files is refused with the limit | #116: the agent reads the cause and waits again (a new wait restores the order, `issue-116.md`) | About 40 to 80 source lines in status text. No scheduling risk. Nothing gets slower, and nothing named gets faster |

The deciding tradeoff: A gives the most predictable answer ("named runs next") but adds two new boundaries. B fixes the losses with no new boundary, and leaves the two lane questions (retry, slow) visible in status.

## Rules and code it replaces (read in spec and source code)

- C15 Lifetime, "Promotion lives in the daemon's memory, and a successor daemon does not inherit it." → the store holds the batch, and the successor takes it over.
- `publishedBatches`' rejection of a predecessor's row (`at < daemonStartedAt`) → kept for readers. The successor republishes what it took over.
- `Promotions.add`, "None at all when no file of it is open" → the wait is kept until its deadline, so a file queued later joins.
- Row 011-207's re-send of asked files (`status-wait-paths.ts:322`) → not needed once the daemon keeps the wait.
- C5, "at most 20 files, the oldest dropped first" → excluding files that an open wait selected.
- Option A only: C5, "It then runs once, forced at the file's normal priority" → as a batch. 004 D2, "holds it back too … unless `squeal run --slow` asked" → also unless a named wait's batch holds the slow file. C15 Constraints, "Promotion does not make the slow tier eligible while a consumer is in a turn" → it does, for the batch's slow files.

## C4 and C15 sentences it changes

- C4 step 5, "While a free lane … holds a file of a named wait's batch (C15), the next tier there is the first such batch's" → add: "a focused tier of a batch is that batch's tier; the backlog's turn follows it" (N1).
- C4 step 5, "After it, while a file of the second group is queued, the backlog's turn is due before any other tier" → "after each batch tier, a focused one included".
- C15 What is promoted, "A file that is current or not queued is not affected" → "a file not queued yet joins its wait's batch when it is queued before the deadline".
- C15 Lifetime, the sentence on daemon memory → "The store holds each batch (`promotions:<worktree>`). A daemon that starts takes over each batch of its predecessor's row whose files it re-queues at the same key, in the same order, before its own requests."
- C15 Constraints, the slow-file sentence → option A only, as above.
- C15 Focused checks, "The daemon keeps a focused entry per file until the deadline" → add: "and its outcome in the row while the wait is open".

## First slice (option B): done-when, as tests

1. A wait for a file that is not queued yet, then the file is queued before the deadline: the file is promoted and leads its lane. After the deadline: it is not (red today, P1).
2. A daemon with a batch of B ahead of A steps down. The successor re-queues A and B at the same keys: B leads, the row is republished, and a wait reads `promoted, in batch 1 of 1` (red today, P3).
3. Same as 2, but B's key moved during the handover: B is not in a batch, and no stale row is read.
4. Two batches in the predecessor's row: the successor keeps their order, and a new wait's batch goes after both.
5. A `--check` wait over 24 files: every file keeps its focused outcome while the wait is open, and the wait settles before its deadline (red today, P4). With no wait open, the row keeps 20.
6. A focused tier of a batch while the post-batch turn is due: the backlog's turn follows the focused tier (0.1.378-r2 N1).

Option A adds: a `retry <file>` placed behind the load gate starts at the first boundary after the gate opens, ahead of the backlog and after earlier batches; a named slow file starts while fast backlog is queued, but not while an edit's work is.

## Open questions

- Not determined: the CPU and memory cost of a named slow file beside a wide batch tier (option A). Nobody has measured it, and `named-wait-batches.md` has the same open question about the second Vitest instance.
- Not determined: whether a successor should take over a batch after a kill or a crash, or only after a step-down with a handoff claim. The rule takes over whatever it re-queues at the same key. An age bound (for example, a row older than 1 h) is a choice, not a measurement.
- Option A, choice: does a retry's batch take its place when the request came or when the gate opened? "When it came" can put it ahead of batches formed while the load gate was closed.
- 011-266 S2: keeping the overlap is inferred from 004 D2. Its effect on a real batch's wall time is not measured.

## Sources

- Brief `tasks/wave-60.md` R1. Board rows gh-110, gh-116, gh-123, gh-125, gh-127, 011-265 to 011-269, at `b34b00682`.
- Research: `004-slow-suites/research/issue-110.md`, `research/issue-116.md`, `issue-123.md`, `issue-125.md`, `issue-127.md`, `named-wait-batches.md`, `issue-79-gate.md`.
- Reviews: `reviews/0.1.377.md` (B1, S2, S3), `0.1.377-r2.md`, `0.1.378.md` (B1, S1), `0.1.378-r2.md` (N1).
- Spec 011 C4 step 5, C5, C9, C10, C15, and `status.md` lines of 2026-10-28 and 2026-10-29. Spec 004 D2.
- Source at `b34b00682`: `src/core/scheduler/promotions.ts` (`add`, `publishedBatches`), `queue.ts` (`orderedBatches`, `hasFirstGroup`, `tierSelected`), `tiers.ts` (`selectTier`, line 425 kind), `retries.ts` (`queueDue`), `slow-tier.ts` (`#fastFirst`), `scheduler.ts` (`#editPending`), `handover.ts`, `focused-row.ts` (`FOCUSED_FILES`, `writeFocused`), `src/cli/status-wait-paths.ts` (lines 308 to 324), `src/cli/main.ts` (lines 129, 133).
- Probe: `probes/011-273/probe.test.ts`, run as `env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run --config docs/specifications/011-core/research/probes/011-273/vitest.config.ts --silent=false --reporter=verbose`. Output in `probes/011-273/result.txt`.
