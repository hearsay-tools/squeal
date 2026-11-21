# `status --at --run` and `proof` with `run --wait` semantics (row 023-37, 2026-11-21)

**Verdict: use a worktree per commit with its own Squeal daemon.** The daemon already has every part the human's model asks for: a queue that keeps running after the call ends, `run <group> <paths> --wait` that a second call joins, the per-user CPU pool, per-tier process cleanup, `squeal ps`, and an exit when its worktree is removed. Its results go to the shared store at the commit's keys, because the daemon keys with the same code path as D2's keyer. So `status --at` reads them with the lookup it has today. A job inside the user's daemon would keep today's batch loop, run child and completion record, only move them into the daemon. It would also die with `squeal stop` or the session, and could not be shared between worktrees.

**Measured cost** (this host, 16 CPUs, real load 14.5 to 19.0, no load made on purpose):
- Once per commit: worktree plus warm install 1.0 to 2.2 s; cold install 4.7 to 10.9 s.
- Daemon start until it accepts work: 22 s (Squeal, 2,092 of 2,093 results found in the store) and 47 s (squawk, empty store).
- Disk: 66 to 350 MB per worktree, almost all of it the checked-out files.
- Memory: 0.7 to 0.8 GB (Squeal) and 1.3 to 1.8 GB (squawk) per idle commit daemon.

**Main risks:**
- Memory: each commit daemon holds about 1 to 2 GB while it lives, so the number of them needs a machine-derived ceiling.
- Start cost: the first `--run` at a commit waits 20 to 50 s for the daemon to key every file. Today a one-file call keys in about 6 s.
- Waste: a daemon in a commit worktree runs lint (seen in squawk), so it needs a commit mode.

Examined: Squeal 0.1.586 source (`bfb9d2328`) and the installed 0.1.586 bundle; squawk `c11e4edf0` (clone, read only). Node 26.13.0, pnpm 12.15.0 / 12.11.2, git 2.43.0. Probes and outputs: `probes/run-wait-model/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Worktree + own daemon vs a job in the user's daemon | Worktree + own daemon. It reuses the queue, `--wait`, store keys, pool and cleanup. New work: worktree identity, a commit mode for the daemon, a lifetime rule and a ceiling. | read in source code; verified by experiment (start, run, stop) |
| 2 | Costs | See the table in Q2. | verified by experiment |
| 3 | Lifetime | Exit 10 min after the last activity. Total cap 3 h. Results kept 7 days, as now. A machine-derived ceiling on the number. Shown by `ps`; stopped by `stop --at`. The sweep removes a worktree when its daemon is dead. | read in source code; numbers inferred |
| 4 | Identity and reuse | One worktree per (repository, commit, environment fingerprint), shared by every caller. Keys equal D2's by construction. Two calls asking for different files make two narrow requests, and the queue shares their files. | read in source code |
| 5 | `proof` | Sides without conditions and repeat: a daemon worktree per (code commit, copied files). `--env`, `--without`, empty `HOME`, `--repeat` and the `dependency` case stay in the call. The split is clean as a rule, but costly for overlay sides that are rarely reused. | read in source code; inferred |
| 6 | What goes away | Take-back, owner claims, give-back, the batch loop, budget sharing, fit, T4's special path and the in-call run of `status --at`: about 1,800 CLI and 400 daemon lines. The proof's in-call path stays. | read in source code |
| 7 | Agent-facing text | `--run` queues and waits up to `--wait`. While work runs: "N still running at <c>, M in the working tree; their runs go on; `… --wait 100000` waits for them". Exit codes stay D1's: 3 while running. | inferred from `run-group-wait.ts` |

## Findings

### Q1. The two designs

**A: a worktree per commit with its own daemon** (read in source code):
- **Start.** `ensureDaemonProcess` (`core/daemon/ensure.ts:225-271`) starts a detached daemon. Its working folder is the store folder, so a removed worktree does not break it.
- **Startup mode.** `baseline.onStart: "lookup-only"` is the default (`types/policy.ts:431`), so the daemon runs nothing on its own.
- **Requests.** `run-group-paths` (`cli/run-group-narrow.ts:70`) queues only the named files.
- **A second call.** The daemon answers a request at once and never waits for the caller (`core/daemon/run-group.ts:261-289`). A second request for files already queued counts them as `shared`, not queued twice (`scheduler/narrow-run.ts:244-268`).
- **`--wait`** holds no socket open: it reads the store once a second (`cli/wait/wait.ts:53-69`). On its deadline it prints "their runs go on in the daemon", exit 3 (`cli/run-group-wait.ts:93-97`). A killed call leaves the work running. That is the human's "finish everything" with no new code.
- **Keys.**
  - The daemon keys at its root through `openDaemonKeying`. D2's keyer calls the same function (`core/commit/at-keys-walk.ts:120-155` → `core/code/gate/stored.ts:288-322` → `core/scheduler/daemon-keying.ts`), with the same commonDir and so the same shared store.
  - The daemon also re-runs a file whose run read a path first seen during it, at the key that includes the path (`scheduler/store-decision.ts:100`, `ledger.ts:639`). The gate does not keep such a file (T4). So the daemon converges where the gate gives up.
- **Pool.**
  - Narrow runs form a batch (`narrow-run.ts:169`). A batch's tier asks the per-user pool as a checkpoint's tier does.
  - When the pool refuses, the tier starts without a permit, at most `runner.tierSize` (4) files (011 spec, "A named wait's batch").
  - So N commit daemons add at most 4·N workers above the slots, the bound edits already have.
- **Cleanup.**
  - After each tier the daemon ends its marked test processes: SIGTERM, then SIGKILL 1 s later (`daemon/escaped.ts:59-76`).
  - `SQUEAL_RUN_GROUP` tokens cover what an `--at` run starts (row 023-36). `squeal stop` ends what a killed daemon left of those.
  - A SIGKILL of the daemon itself is not covered by 011. D6's working-folder sweep at removal (`checkout/left-under.ts`) covers what runs under the checkout.
- **Lifetime.** The daemon exits when its worktree is removed (`lifecycle.ts:293-303`, checked every 5 s) or after `daemon.idleExitMinutes` (60) with no request and no file a request queued (`lifecycle.ts:312-337`).

**What A needs that is new:**
1. The worktree's identity, and its reuse under the lock that exists (`checkout/checkout.ts:52-73`).
2. A marker owned by the daemon, not by the call (`checkout/marker.ts`).
3. A commit mode for the daemon: lookup-only forced, no lint, no complexity count, a short idle exit. The squawk probe's daemon started linting 3,471 files in a worktree nobody edits.
4. A ceiling on the number of commit daemons.
5. Removal at exit or by the sweep.
6. `ps`/`stop` text.

**B: a job in the user's daemon** (read in source code; inferred):
- The user's daemon schedules one root. A job at another commit cannot use its scheduler, keyer or runner hosts. It would launch today's gate child (`status-at-run-child.ts` `runInChild`) and keep the batch loop, the completion record and the budget, now inside the daemon.
- **New:**
  - a job registry and its protocol;
  - `--wait` on job state (the store poll covers only the daemon's own root's files);
  - pool permits for a child process the daemon does not schedule.
- **Lost:**
  - `status --at` works today with no daemon, and then the job has nowhere to live;
  - `squeal stop`, the end of the session, and the 30 min unused exit end the job, against "finish everything";
  - two agents in two worktrees asking for one commit get two checkouts and run the files twice, deduplicated only through the store afterwards.

### Q2. Costs (verified by experiment, `probes/run-wait-model/out/`)

| | Squeal `7591bf996` (worktree of the real repository, shared store) | squawk `c11e4edf0` (clone, empty store) |
|---|---|---|
| `git worktree add --detach` | 1.63 to 1.74 s | 0.45 to 0.49 s |
| Frozen install, warm | 0.54 s, 0 downloaded | 0.62 s, 0 downloaded |
| Frozen install, cold (empty pnpm store and cache) | 10.9 s, 321 MB downloaded | 4.7 s, 154 MB |
| Disk: checkout without `.git` / node_modules held only here / hard-linked | 335 MB / 15 MB / 797 MB (no new disk) | 65 MB / 1 MB / 451 MB |
| `squeal start` returns | 0.96 s | 0.54 s |
| Start until `status --wait` returns (lookup-only settled; requests are taken only after this pass, `request-intake-requests.ts:90-93`) | 21.7 s; 2,092 of 2,093 current, inherited from 12 worktrees | 47.5 s; 1,931 unknown; lint started |
| One narrowed `run tests <file> --wait` after that | 2.7 s | 3.4 s (ran) |
| Idle memory 30 s after settling: daemon + runner hosts (RSS / PSS) | 828 / 699 MB (2 processes) | 1,800 / 1,573 MB (4 processes) + the clone's store process 393 MB |
| Idle 30 s after the run | 708 / 576 MB | 1,307 / 1,077 MB + store process 399 MB |
| `squeal stop` | 0.88 s, no process left | 1.09 s, no process left |
| Load (1 min) | 15.8 → 17.6 | 16.4 → 19.0 |

- **The store process.** It belongs to a clone, not a worktree. A commit worktree of the user's repository shares the user's store process, so it is not a per-worktree cost.
- **Other daemons for comparison.** The 7 other daemons running on this host at about 15:27Z held 301 to 876 MB, plus 0 to 625 MB of runner hosts each.
- **Today's per-call cost for comparison** (023-01 and D2): every call makes the checkout and installs again (1 to 3 s), keys again (5.8 to 6.4 s for one file, 50 s for all) and removes the checkout (1.0 to 1.5 s).
- **What changes.** A commit daemon pays 22 to 47 s once per commit and lifetime. Later calls pay about 0 s.
- **Where it is slower.** For a single one-file call to a new commit, the daemon is slower than today (22 to 47 s against about 8 s), because a lookup-only start keys every test file.

### Q3. Lifetime (numbers inferred; mechanisms read in source code)

- **Ends when:**
  - **idle:** 10 min with no request, no queued or running file and no file ending. This is the existing idle rule with a commit-mode value; the default 60 min is too long at 1 to 2 GB.
  - **total cap:** 3 h from start, the default of `squeal hold --max`. After it the daemon takes no new request, lets its running tier end, and exits.
- **Waiting calls.** `--wait` does not open the socket, so a waiting call is invisible to the daemon. That is harmless: a call waits only while its files are queued or running, and those keep the daemon active. To check in the row: that a queue waiting for a pool permit counts as activity.
- **At exit.** The daemon removes its worktree: D6's working-folder sweep, then `worktree remove --force`, then `prune`.
- **Results** stay in the store 7 days (`store/prune-rules.ts:15-32`).
- **How many at once.** A ceiling per user derived from the machine's memory, for example the smallest of 4 and a quarter of total memory divided by 2 GB: 7 on 62 GB, 2 on 16 GB. Idle commit daemons over it are stopped oldest first. A running one is never stopped. A call that finds the ceiling full of running daemons queues behind the first to end, and says so.
- **What `squeal ps` and `squeal stop` show.**
  - `squeal ps` already lists every daemon of the user. It should name a commit daemon by commit and use: "commit 7591bf9 (status --at, proof), 3 files running, idle exit in 10 min".
  - `squeal stop` in the user's worktree stops only that worktree's daemon.
  - `squeal stop --at <commit>` stops a commit daemon and removes its worktree.
- **After a crash.** The marker names the daemon's pid and start time. The existing sweep (`checkout/sweep.ts`, run at each checkout start and in the daemon's prune) removes a worktree whose daemon is dead, after the working-folder sweep. The next daemon releases a dead daemon's claims (`releaseRunning`).

### Q4. Identity and reuse (read in source code)

- **Identity.**
  - The worktree lives in `<checkouts>/<repo id>/<commit>-<env8>/`.
  - `<repo id>` comes from the git common folder, so agents in every worktree of one repository share it.
  - `<env8>` hashes what the daemon puts into the environment hash but the commit does not fix: `process.version`, and the allow-listed variables (`keys/environment.ts:37-50`; the list is empty by default, `types/policy.ts:435`).
  - The daemon inherits its starter's environment (`ensure.ts:206-210`). So a caller under another Node gets its own worktree, never results keyed for another Node.
- **Keys.** The daemon keys the commit's tree as D2's keyer does. These are the commit's keys by construction (D2 as amended 2026-11-17).
  - `status --at` should read a live commit daemon's file keys rather than key again. They include what the daemon's runs added (observed growth), which a fresh keyer lacks.
  - Without a commit daemon, today's keyer path stays.
- **Two calls, different files of one commit.**
  - Each call sends its own narrow request and waits only on its own covered files.
  - Files both calls ask for are queued once (`shared`).
  - Files a later call names lead the queue (`lead`, `Promotions.add`).
- **Concurrent first calls.** The checkout lock serializes creation. The daemon lock (`locks/<id>.sqlite`) allows one daemon per root.

### Q5. `proof` (read in source code; inferred)

- **What a side is.** A side is a tree: the code version plus copied test files, `--with` and `--source` files.
- **Sides with no condition and no repeat:**
  - The green side is the clean commit at HEAD. It goes to the commit worktree at HEAD, shared with other calls.
  - The red sides are mixed trees: a `source` red side is base plus HEAD's test; a `test` red side is HEAD plus the base's test. Each needs its own worktree per (code commit, hash of the copied blobs). Its daemon sees the copies as working-tree content and keys them as content. Unconditioned sides are stored today (`proof-run.ts:136-151`), so storing them from a daemon changes nothing.
- **Sides that stay in the call:**
  - `--env`, `--without`, `--home-keep` and empty `HOME` change the process environment or the tree per call. A daemon's environment is fixed when it starts, and such results are never stored.
  - `--repeat` reruns a file whose result is current, which a daemon does not do.
  - The `dependency` case requires a condition, so it stays whole.
  - These keep `withCheckout`, `runInChild`, `runGateFiles` with `store: false`, `outcomesOf` and `ownHome`.
- **Is the split clean?** As a rule, yes: a side runs in a daemon worktree if and only if it has no condition and no repeat.
- **Costs of the split:**
  - Two lifetimes for proof sides.
  - Overlay worktrees are seldom reused, because the copied test changes with each fix. Each pays the 22 to 47 s start for one file, where today's in-call side keys in about 6 s.
  - Recommended: move the green side in the first proof row, and the overlay red sides in a later row, only after the first rows measure the start cost on a quiet machine.

### Q6. What goes away (read in source code; line counts at `bfb9d2328`)

- **The take-back path:**
  - daemon side: `scheduler/take-back.ts` (171), `daemon/take-back-requests.ts` (63), owner claims in `narrow-run.ts` (about 100) and `queue.ts` (about 40), protocol, handlers and types (about 60);
  - CLI side: `status-at-run-give-back.ts` (92).
- **The in-call run of `status --at`:**
  - `status-at-run-loop.ts` (200), `status-at-run.ts` (312), `status-at-both.ts` (176, most of it), `status-at-run-now.ts` (286, down to one narrow request and a wait), `status-at-run-now-gate.ts` (114), `status-at-run-fit.ts` (108), `status-at-run-use.ts` (97), `status-at-run-setup.ts` (94) and `status-at-run-only.ts` (33);
  - from `status-at-run-batches.ts` (177), only `estimateOf` stays, for the next-step text;
  - `status-at-run-unkept.ts` (75) goes too, because the daemon reruns first-seen files.
- **The run child and the completion record.** They leave `status --at`. They stay for proof's conditioned sides: `runInChild`/`runChild` (273), and the record in `status-at-run-child.ts:146-165` and `status-at-run-outcome.ts:118-182`.
- **What stays:**
  - `lead` (named files first);
  - the `at` flag and the `SQUEAL_RUN_GROUP` token (T3): the working-tree side still runs in the user's daemon and can still leave servers behind;
  - `owner` shrinks to the run-group flag's key, which the covered-files id can replace.
- **The working tree without a daemon.** It starts the user's daemon as `squeal start` does, instead of the gate (`status-at-run-now-gate.ts`).

### Q7. Agent-facing text (inferred from `cli/run-group-wait.ts:69-102` and lessons rounds 4 and 5)

- **Command:** `squeal status --at <c> [<path>...] --run [--wait [<ms>]] [--all-missing]`.
- **Without `--wait`:** `--run` waits 100,000 ms by default. That is under Claude Code's 120 s default tool limit: round 5's T6 found that calls whose budget equals the tool limit go to the background, and their output is not read.
- **`--wait <ms>`** sets the wait. A bare `--wait` waits until done, as `run <group> --wait` does.
- **`--wait` without `--run`** joins the work already queued and starts none. This replaces T5's refusal.
- **`--timeout`** is a usage error that names `--wait`.
- **While work runs**, the comparison of what is known now, then:
  `412 still running at 7591bf9 (its worktree), 9 in the working tree; their runs go on in the daemons. squeal status --at 7591bf9 --wait 100000 waits for them; squeal ps shows them.`
- **When a run ends with no result** (setup failure, R3), the text and the line stay as now.
- **Large selections:** the R4 estimate is printed once at queueing, "about 79 min at this machine's rate; name files or folders to narrow it". A later narrowed call leads the queue.
- **Exit codes, D1 unchanged:**
  - `0`: every selected file is known on both sides;
  - `3`: some file is still running, unknown or not comparable (`run --wait`'s "no verdict");
  - `2`: usage or setup error.
  - A changed outcome is the answer, not exit 1. This is the one deliberate difference from `run --wait`.

## Recommendation for Squeal

1. **Build A.** Spec amendments:
   - **D1:** replace `--timeout` with `--wait [<ms>]`, 100 s by default with `--run`; allow `--at … --wait` to join queued work (replaces T5); exit codes unchanged.
   - **D4:**
     - Steps 2 to 8 become: find or create the commit worktree for (commit, environment), install once, start its daemon in commit mode, and send one narrow request per group.
     - Step 6 (budget, batches, completion record) is replaced by `--wait`.
     - Step 8 (removal) moves to the daemon's exit and the sweep.
     - Step 10's working-tree side becomes a narrow request to the user's daemon, started if none runs.
     - Step 11: take-back is removed, `lead` stays, and T4 is handled by the daemon's first-seen rerun.
   - **D5.1 and D5.2:** sides with no condition and no repeat run in daemon worktrees (green first, overlay red later). D5.3 and D5.4 are unchanged, in the call.
   - **D6:** add the commit daemon's lifetime (10 min idle, 3 h cap), its ceiling, the marker owned by the daemon, `ps` naming and `stop --at`.
2. **Rows, in this order:**

   | Row | Shape | Depends | Owns |
   |---|---|---|---|
   | 023-38 commit worktree: identity, reuse under the lock, install once, marker owned by the daemon, sweep, `ps`, `stop --at`, ceiling | slice | | `src/core/checkout/**`, `src/cli/ps*`, `stop*` |
   | 023-39 daemon commit mode: lookup-only, no lint or complexity count, 10 min idle, 3 h cap, removes its worktree at exit (spec 011 files; coordinate with 011) | slice | | `src/core/daemon/lifecycle.ts`, policy |
   | 023-40 `status --at --run` on the commit daemon: requests, `--wait`, text, exit codes; keys read from a live commit daemon | slice | 38, 39 | `src/cli/status-at*.ts` |
   | 023-41 remove take-back and owner claims; delete the in-call `status --at` run | repair | 40 | scheduler, daemon protocol, `status-at-run*` |
   | 023-42 `proof` green side on the commit worktree | slice | 40 | `src/cli/proof*.ts` |
   | 023-43 `proof` overlay red sides on per-overlay worktrees, only if 023-40's measurements show a start cost worth paying | slice | 42 | `src/cli/proof*.ts`, `at-keys-side.ts` |
   | 023-44 dogfood round 6: s1, s2 on the release | proof | 41, 42 | `tasks/023-44/` |

3. **Measure first in 023-40:** start to first result on a boat.dev sandbox (quiet), and the memory of a commit daemon in commit mode (no lint).

## Open questions

1. **Product, for the human:** the default wait of `--run` (100 s here), or no default wait, as `run <group>` has. With no wait, every answer needs a second call.
2. **Product:** the ceiling on commit daemons and what a call does when all are running: queue, as proposed, or refuse.
3. **Not determined:** start cost on a quiet machine, because every probe here ran at a load of 14.5 to 19 on 16 CPUs. The idle memory of a commit-mode daemon is not determined either, because there is no such mode yet. The probe's daemons ran lint and kept up to 3 runner hosts.
4. **Not determined:** whether a queue waiting for a pool permit keeps the daemon from its idle exit. That needs a read of `lifecycle.ts:312-337` against the pool wait in row 023-39.
5. **Not determined:** whether a lookup-only start could key only the requested files. That would bring a one-file first call near today's 6 s, but it is scheduler work outside this spec.

## Sources

- Squeal at `bfb9d2328`:
  - `src/cli/status-at*.ts`, `proof*.ts`, `run-group.ts`, `run-group-narrow.ts`, `run-group-wait.ts`, `wait/wait.ts`;
  - `src/core/checkout/*.ts`, `src/core/commit/at-keys-*.ts`;
  - `src/core/daemon/{ensure,lifecycle,run-group,handlers,escaped,run-groups*}.ts`;
  - `src/core/scheduler/{narrow-run,queue,take-back,store-decision,ledger,tiers}.ts`;
  - `src/core/keys/{environment,environment-hash}.ts`, `src/core/types/policy.ts`, `src/core/store/prune-rules.ts`.
- Specs:
  - 023 `spec.md` D1 to D6, `lessons.md` rounds 4 and 5, `tasks/023-34-notes.md`, `tasks/023-36-notes.md`, `research/temp-checkout.md`;
  - 011 `spec.md` Capacity (lines 353 to 367).
- Repositories: squawk at `c11e4edf0`, from `git clone --no-checkout` of `~/projects/cezar` (read only). Its `squeal.config.json` has `baseline.onStart: "lookup-only"`.
- Probes: `probes/run-wait-model/README.md`, `daemon-cost.sh`, `out/*.txt`; install timings by `probes/temp-checkout/measure-install.sh`.
