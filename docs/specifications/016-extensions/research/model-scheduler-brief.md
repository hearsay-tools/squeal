# Research brief 016-18: a model-based test of the scheduler

Use /researcher. Shape: research. Outcome: whether a model-based test (generated events and await interleavings, checked against invariants 011's spec states) finds past scheduler race and order blockers, what it costs, and what it would take as a real test file. The human approved it on 2026-10-25. Results go to 011's coordinator (04a258b0), which owns these seams; a test file in `test/scheduler/` afterwards would be a 011 row. Follow `README.md`, except as stated under Cost.

Read first: `core-defects.md` (findings 2 to 4, recommendation 4; the scheduler race and order groups); 011 C4, C5, C6 and C15; `test/scheduler/helpers.ts` (the real scheduler and store in process); `test/scheduler/tier-yields-named.test.ts`, tests 10 and 11 (an injected clock that crosses between reads).

Guards: pin `host: null` in the capacity options, as `test/scheduler/helpers.ts:353` does, so the probe never reads this host's `/proc/stat`. Scratch clones, with their `HOME`, `XDG_*` and `TMPDIR`, stay under `/tmp`. Never touch a live daemon socket or the live permit pool. No package installs: write a small seeded generator.

Questions:

1. **Invariants.** Which invariants of C4, C5, C6 and C15 a generated test can check from the store and the scheduler's outputs, each with its spec line. Include 011's three from row 011-184:
   - (a) once a tier has run 30 s, a promoted file makes it yield only when it ranks before every file of the tier that has not ended; a file that the same or an earlier open wait selected ranks first;
   - (b) a tier that stands on `named` is decided again when one of its files ends, and when the deadline of the promotion that sets the rank to beat passes, including during the decision itself;
   - (c) a tier is cut at most once, and no file of a tier that has not ended loses its protection while its wait is open.
2. **Model.** The event set (edit, result, restart, install, `run --all`, cancel, a wait, a promotion, a clock step) and how await interleavings are forced: a fake runner that resolves on command, an injected clock, deterministic ordering of promises.
3. **Replay.** For five past blockers from the race and order groups, each with a known fix commit, prefer 011-era ones. Run the generator against each pre-fix commit in a scratch clone, with a fixed seed list and budget. Report: found or not, the shortest failing sequence, and the sequences tried before the find. Also run it on HEAD and report every failure.
4. **Shape.** As a real test file: lines, run time, flake risk, and the invariants it cannot check.

Cost: one coarse wall time and CPU figure per 1,000 sequences, from a single run under `nice`, with the one-minute load beside it. Run one probe at a time. No paired timings.

Own `model-scheduler.md` and `probes/model-scheduler/`.
