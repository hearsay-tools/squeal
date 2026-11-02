# 017-26: where the lint daemon's memory goes

Researcher, 2026-11-02, task b8bcebbe. Brief: `tasks/wave-5.md`, R1. Host: 24 CPUs, 47 GB, Linux 6.8.0-147, Node 24.22.1. Squeal 0.1.391: the worktree's committed bundle (`plugins/claude-code/dist`), copied. The two dogfood repositories of 017-13, cloned again from its bundles in a scratch `/tmp/lint-memory-b8bcebbe` with its own `HOME`, `TMPDIR`, `XDG_*` and pnpm store:

- **saas** at `b36f7150`: ESLint 9.39.2, Nx, 24 package configs, no typed rules, the `import` plugin. Run with `ESLINT_FLAGS=v10_config_lookup_from_file`, which row 017-24 makes the default: 2,575 files linted, 14 distinct computed configs, 272 packages loaded, 1,352 whole-program files, no TypeScript program.
- **Svelte** at `356c8766a`: ESLint 10.0.0, typed rules (`projectService`), TypeScript 5.5.4: 382 files linted, a program of 3,324 files. A branch `untyped` sets `projectService: false` and turns the two typed rules off.

RSS, not CPU, is the measure. The host's load was 34 to 71 on 24 cores, from other work. Probes and logs: `probes/lint-memory/` (throwaway; README there). "Live" is the heap after a major GC in that isolate; "physical" is the heap's resident pages.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | saas, daemon and worker: at start, after the first pass, idle | Lint off, the daemon settles at 139 to 141 MB. Lint on: 139 MB when the worker starts, a peak of 1,171 MB during the first pass, 949 MB at its end, 474 MB after 3 minutes idle. The worker's live heap at the end is 123 MB. | verified by experiment |
| 2 | Svelte, the same | Lint off: 268 to 284 MB (Vitest's instance). Lint on: 304 MB when the worker starts, a peak of 1,487 MB at the end of the first pass, 891 MB after 3 minutes idle. The worker's live heap: 476 to 480 MB. | verified by experiment |
| 3 | The split | TypeScript's program is the largest live part: about 380 MB in Svelte, none in saas. The config with its plugins: 75 to 85 MB. ESLint itself: about 6 MB. The program walk: 16 MB. The held-bytes maps: under 3 MB. Lint state in the daemon's own isolate: under 10 MB after a GC. The rest of each peak is garbage not yet collected: before a GC, the worker's heap held about 3 to 4 times its live set. | verified by experiment |
| 4 | A bound or a D10 amendment | Both. A heap cap on the worker (`resourceLimits.maxOldGenerationSizeMb`) cut the peak by 31 to 44%. With the cap well above the live set, there was no CPU cost outside noise. Below the live set, the worker ends with `ERR_WORKER_OUT_OF_MEMORY` and the process lives. D10's "290 to 320 MB" also needs restating with these numbers. | verified by experiment; the docs read |

## 1 and 2. RSS over a first pass

A daemon was started with `inside.mjs` preloaded (`run-daemon.sh`). The preload samples `/proc/self/status` and both isolates' heaps every second. `lint.sqlite` was removed first, so every file was linted. MB throughout; the load is the one-minute average. *Verified by experiment* (`logs/daemon-*/inside.jsonl`).

| Point | saas RSS | saas worker used / physical | Svelte RSS | Svelte worker used / physical |
|---|---|---|---|---|
| Lint off, settled (after a GC) | 139 to 141 (peak 257) | – | 268 to 284 (peak 502) | – |
| Worker started | 139 | – | 304 | – |
| Peak, during the first pass | 1,171 (load 56) | 584 / 674 | 1,487 (load 51) | 920 / 1,060 |
| End of the first pass | 949 (80 s) | 322 / 614 | 1,480 (58 s) | 920 / 1,060 |
| Idle 60 s | 951 | 322 / 614 | 1,445 | 920 / 1,060 |
| Idle 120 s | 511 | 122 / 162 | 906 | 480 / 512 |
| Idle 180 s | 474 | 122 / 162 | 891 | 476 / 493 |
| Major GC in both isolates | 475 | 119 / 149 | 889 | 476 / 493 |
| Last-resort GC in both | 420 | 119 / 122 | not logged (see Open questions) | |
| Worker ended (`squeal stop`) | 386 | – | 805 | – |

- **The idle drop is V8's memory reducer in the worker.** About 2 minutes after the pass, with no GC asked for, the worker's physical heap fell from 614 to 162 MB (saas) and from 1,060 to 512 MB (Svelte). The daemon's idle GC (011-69) collects only the daemon's own isolate. A last-resort GC in the worker after that gave back only 27 MB more (saas). *Verified by experiment.*
- **The end of the worker gives little back at once.** RSS fell 34 MB (saas) and 84 MB (Svelte). In Svelte, the 256 KiB V8 pages fell only from 610 to 558 MB. Whether the pages go back later was not measured. *Verified by experiment; what happens later is not determined.*
- **Against 017-13.** Dogfood on 0.1.390 measured a saas peak of 2,192 MB and 491 MB idle, and a Svelte peak of 1,850 MB and 836 MB idle. Here, on 0.1.391, the idle values agree (474 and 891 MB). The saas peak is 1,171 MB, about half. 017-13's peak was not reproduced (Open questions). The ESLint CLI itself peaked at 1,604 MB on saas and 1,514 MB on Svelte (017-13): the daemon's peak is not above the CLI's.

## 3. The split

`stages.mjs` runs Squeal's own `lint-worker.mjs`, unchanged, through `worker-wrap.mjs`. It makes a first pass's calls in a stand-alone process: `open`, `inputs` for every listed file, `refresh`, then `lint` in parts of 16 with each file's text and blob. After each stage, it runs a major GC in the worker's isolate and logs the live heap. Each difference between stages is one part. *Verified by experiment* (`logs/stages.jsonl`; load 39 to 53).

| Stage, worker live heap (MB) | saas | Svelte typed | Svelte untyped |
|---|---|---|---|
| Empty worker, Squeal's observer installed | 8 | 8 | 8 |
| `open`: ESLint loaded | 15 | 14 | 14 |
| `inputs`: the config, its plugins and every file's computed config | 100 | 89 | 89 |
| `refresh`: the program walk | 101 | 105 | 90 |
| `linted`: every file linted once | 123 | 480 | 100 |
| Before that last GC (garbage included) | 386 to 404 | 1,203 to 1,321 | 367 |
| Process RSS at the end, with stage GCs / without | 942 / 1,215 | 1,672 / 1,597 to 1,707 | 829 / – |

| Part | saas | Svelte | How it is read |
|---|---|---|---|
| **TypeScript's program** (typescript-eslint's project service) | 0 | **about 380** | typed `linted` minus untyped `linted`: 480 − 100. During the first part, while the program is built, the live heap reaches 568 to 586. |
| **The config and its plugins** | 85 | 75 | `inputs` minus `open`. Svelte's plugin loads the repository's own compiler (233 files, L9); saas loads 272 packages for its 14 configs. |
| **The ESLint instance** | 7 | 6 | `open` minus the empty worker. Its lint-time caches add 22 MB (saas) and 10 MB (Svelte untyped): `linted` minus `refresh`. |
| **The program walk** (`ProgramReader`) | 0 | 16 | typed `refresh` minus `inputs`; 3,324 files walked. Untyped: 1. |
| **The held-bytes maps** | under 0.1 | 1.6 in the worker, 1.2 in the daemon | `held-replica.mjs`: maps of the same shape at 3,327 paths (Svelte's count; saas reports 22). At 20,000 paths: 9.5 and 7.8. |
| **Lint state in the daemon's isolate** | under 5 | about 7 | The main isolate's live heap after a GC, lint on minus off (saas 32 against 30 to 32; Svelte 91 against 84). During a pass it also holds every file's computed config as JSON: 4.7 MB (saas, 1.8 KB per file) and 14.7 MB (Svelte, 38 KB per file). |
| **The daemon without lint** | 139 | 268 to 284 | the lint-off run |
| **Garbage, at the peak** | 260 to 290 | 720 to 840 | used before the GC minus live. Nothing in the worker makes V8 collect earlier: a worker without `resourceLimits` gets the process's limit, 4,288 MB of heap on this host. |
| **Outside the heaps** | about 170 | about 110 | idle RSS minus the daemon's lint-off RSS, the worker's physical heap and the daemon's lint state: code, stacks and native allocations, not split further. |

So, at idle, lint costs about 335 MB over the daemon on saas (474 − 139) and about 610 MB on Svelte (891 − 280). During a first pass, it costs 1.0 to 1.2 GB over the daemon, most of it garbage. *Inferred* from the two tables.

**Open question 1 of the spec** (TypeScript's share): TypeScript's program is about 80% of Svelte's live worker heap (380 of 480 MB). The same project without typed rules holds 100 MB. A project without typed rules still pays the garbage peak: saas, with no program at all, peaked at 1.2 GB.

## 4. A bound

`LM_OLD_MB` starts the worker with `resourceLimits: { maxOldGenerationSizeMb }`, with no GC between stages, as in the daemon. One run each. CPU is the process's own, at the load given. It is only an indication. *Verified by experiment* (`logs/stages-cap.jsonl`).

| Cap (MB) | Svelte typed: peak RSS, CPU s, load | saas: peak RSS, CPU s, load |
|---|---|---|
| none (4,288) | 1,597, 53.5 s, 52 | 1,227, 64.7 s, 67 (another run: 1,258, 58.2 s, 43 to 52) |
| 1,024 | 1,099, 55.3 s, 35 | – |
| 768 | 1,014, 56.8 s, 34 | – |
| 512 | 789, **121.5 s**, 39 | 689, 69.5 s, 44 |
| 384 | the worker ended after `refresh`: `ERR_WORKER_OUT_OF_MEMORY` ("reached its memory limit"); the process lived on (peak 649) | – |
| 256 | – | 586, **97.1 s**, 44 to 71 |

- **The tradeoff.** A cap well above the live set (Svelte 768 for a live set of 480 to 586 MB; saas 512 for 120 to 135 MB) cut the peak by 36 to 44%. The CPU difference was within the spread between runs at this load. At about the live set (Svelte 512, saas 256 at about twice its 120 MB), V8 collects all the time: 1.5 to 2.3 times the CPU. Below the live set, the worker ends. *Verified by experiment.*
- **The failure is contained.** Node's docs (v24, `worker_threads`, `new Worker` options): "Reaching these limits leads to termination of the `Worker` instance. These limits only affect the JS engine, and no external data … the process may still abort if it encounters a global out-of-memory situation". `ERR_WORKER_OUT_OF_MEMORY` (v24 `errors`): "The `Worker` instance terminated because it reached its memory limit." *Read in official docs.* `LintThread` handles a worker `error` as `the ESLint worker threw: …`, a failed thread that D3 counts toward its 3 in 10 minutes (`src/core/lint/provider/thread.ts`, constructor and `fail`). *Read in source code, 0.1.391.* So a project whose live set is larger than the cap would get `unknown`, then lint off with that reason: a user-visible effect.
- **What a cap does not bound.** Native memory outside V8's heap, the new space, and the code space (`codeRangeSizeMb` is another limit). The process's peak RSS stayed 180 to 330 MB above the cap. The young generation (`maxYoungGenerationSizeMb`) was not measured.

## Recommendation for Squeal

1. **Amend D10's memory line.** It should read from these numbers, not "about 290 to 320 MB per warm worker". Over the daemon without lint: about 335 MB idle without typed rules (saas, 2,575 files) and about 610 MB idle with typed rules (Svelte, a 3,324-file program). TypeScript's program is about 380 MB of that. During a first pass, 1.0 to 1.2 GB over the daemon, mostly uncollected garbage, as the ESLint CLI shows too. V8 gives the garbage back about 2 minutes after the pass. Goal 9's "at most about 350 MB" holds idle without typed rules on saas; with typed rules or during a pass, it does not.
2. **Bound the worker's heap**, if the human wants peaks bounded: `resourceLimits.maxOldGenerationSizeMb` on the worker that `LintThread` starts. The evidence supports a fixed cap of about 1,024 MB for a first version. Svelte's peak went from 1,597 to 1,099 MB with no CPU cost measured. A typed live set up to about 600 MB has room under it. A larger program reads `unknown`, then lint off with a reason that names the memory limit. Two cheaper alternatives were not measured: a key that sets the cap, and a cap from the live set seen after the first pass. The coordinator decides between them. The effect on users is a product decision for the human: a smaller peak, against lint off on the largest typed programs.
3. **Do not add an idle GC or an idle exit for the worker.** The reducer already returns the garbage within about 2 minutes. A last-resort GC in the worker gave back 27 MB more, and ending the worker gave back 34 to 84 MB at once.
4. **Leave the held-bytes maps and the program walk as they are.** They are under 3 MB and 16 MB.

## Open questions

- **017-13's 2,192 MB saas peak.** It was not reproduced: 1,171 MB here. Its run used 0.1.390, at load 15.7 to 17.1, with 0.1.390's worker in the daemon's directory (12 false findings, L3). GC timing under another load and the version change both fit. Not determined, because 0.1.390 was not run here.
- **Over a session.** Each config-input edit starts a new worker (D4 level 3). Whether RSS grows across worker restarts was not measured: only one worker per run. The 84 MB drop at the end of Svelte's worker suggests that pages stay in the process for a while (inferred).
- **Larger typed programs.** The live set grows with the program. Svelte's 380 MB of TypeScript program for 3,324 files is one point. A cap must be checked on a larger one before it is fixed.
- **The young-generation cap and a second install** (several workers per daemon, open question 4) were not measured.
- **Svelte's last-resort GC sample** was lost: the daemon stopped while the probe ran it.

## Sources

- Probes and logs: `probes/lint-memory/` (README), runs 2026-11-01 23:53Z to 2026-11-02 00:25Z.
- Squeal 0.1.391 source: `src/core/lint/provider/thread.ts`, `worker.ts`, `observe.ts`, `session.ts`, `program.ts`; `src/core/lint/pass/keyer.ts`, `held.ts`; `src/core/daemon/idle-gc.ts`.
- Node.js v24 docs, `worker_threads` (`resourceLimits`, `worker.getHeapStatistics()`): https://nodejs.org/docs/latest-v24.x/api/worker_threads.md, fetched 2026-11-02. `ERR_WORKER_OUT_OF_MEMORY`: https://nodejs.org/docs/latest-v24.x/api/errors.md.
- Earlier evidence: `lessons.md` Round 1 (017-13), `research/eslint-provider.md` Q3 (memory), 011 `research/daemon-memory.md` (V8 page pooling, the last-resort GC, the smaps method).

Clean-up: every daemon of this research was stopped with `squeal stop` (`logs/daemon-*/run.txt`). The scratch was removed afterwards; the check is in the commit message.
