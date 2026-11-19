# Research brief 011-400: where the idle CPU and the selection time go in a broad change

Use /researcher. Shape: research. Outcome: numbers that let the human choose how Squeal should use the CPU it now leaves idle, and why finding the affected tests takes so long.

## Why

Row 011-395 (`broad-change-throughput.md`) measured, for one edit queuing 1,200 files on a quiet 12-vCPU VM: Squeal 1,143 s against plain `vitest run` 510 s; 57% of the extra time is CPU left idle (6.0 of 12 busy); the runner part (re-key and closures) took 22.5 to 45.6 s; listing a revision about 21 s on squawk (`stuck-running.md` E4b). The human asked on 2026-11-19 for this experiment and three more questions.

## Read first

Both findings files above and their probes (re-use them); spec 011 C4 step 5 (tiers, budget), C10 (capacity, lanes, permits), spec 021 D18 (CPU ceiling); `src/core/scheduler/refinement.ts`, `runner-work.ts`, `src/core/capacity/{pool,cores,background}.ts`. Coordinator 585446dc (spec 021) measured the CPU ceiling on the same VM today: ask your coordinator for its findings path before designing question 3; do not repeat it.

## Where to run

The lab VM in the shared notes (read its topic first, including the Linger note). **It is reserved by another coordinator until about 09:45Z: do source reading and probe setup first and start no VM run until your coordinator tells you it is free.** Then check its load, work under `~/work/011-400/`, delete it and leave no process at the end. Keep one ssh session open for long runs.

## Questions

1. **The 57%.** Split it between the backlog grant width, the wait for each tier's slowest file and the Vitest start per tier: runs with `capacity.backgroundShare` 1.0, with a large `runner.backlogTierSize` budget, and both. Repeat the 011-395 edit with the `run-loop` group held, as when an agent is mid-turn.
2. **Selecting affected tests.** Why does the runner part take 22 to 46 s for 1,297 files, and listing about 21 s per revision? Time its phases (closure calls, re-key, store writes, Vitest listing) and say which grow with files and which are fixed.
3. **One Vitest, many workers.** Would one long-lived Vitest instance whose `maxWorkers` follows the slots granted, fed files as workers free (no tier barrier), clear the queue faster? Measure what you can (a long run at the grant width against tiers), and read what Vitest 4's API allows (cite the version).
4. **A cap on total CPU across all daemons instead of slots.** With two and three daemons on the VM, compare the slot rule with a cap on measured total CPU of all daemons: throughput, and how far each overshoots or under-uses the machine.

## Rules

Tag each finding. No design, no product code; config changes only in the VM's copy. Own `research/broad-change-throughput-2.md` and `research/probes/broad-change-throughput-2/` only. Budget about three hours of VM time. Done when questions 1 to 4 have numbers and tags or "not determined, because", and the probe README says how to re-run. Commit.
