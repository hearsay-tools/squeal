# Research brief 016-34: the per-edit cost of three ways to connect a check provider

Use /researcher. Shape: research. Outcome: the CPU and wall time per edit of an in-process JavaScript binding, a persistent stdio JSON-RPC process and a per-run command with a report file, under equal selection and startup, so that the provider contract can say which binding suits which tier. Follow the rules in `README.md`, except the timing rule: the human (2026-10-26) authorized timings for this brief on the conditions below.

Read first: `check-protocol-judgment.md` (divergence 4 and its open experiment, spec input 1); `plugin-mechanisms.md` (two tiers; isolation by worker thread or child process); 011 C4 (the scheduler) and C14 (`RunnerAdapter`); `src/core/types/runner.ts`.

Questions:

1. **Harness.** One provider with the same logic behind all three bindings: a trivial check, and one real tool run on one file (ESLint or `tsc` in a scratch directory under `/tmp`). Selection and startup policy are equal across bindings. Write it under `probes/binding-cost/`.
2. **Cost per edit.** For each binding, the CPU time (user plus system) and wall time from an edit to a result, cold and warm, with encoding, framing, process start and module load counted. Give the median and the spread over at least 20 samples.
3. **Scheduler calls.** How many provider calls each binding needs per edit when scheduling hints stay local, and what a call costs when the scheduler holds its lock.
4. **Containment.** Whether each binding keeps a provider that blocks or throws from stalling the daemon's timers (`plugin-mechanisms.md` found that in-thread code can).

Conditions for timings:
- Finish the probe first. Then send me a request: "016-34 ready to measure". Measure only after my reply, because other coordinators take turns on this machine.
- Start each sample only when the one-minute load is below the CPU count, and record the load beside each sample. Make no load of your own on purpose.
- Tell me with a progress message when the measurements end.

Own `binding-cost.md` and `probes/binding-cost/`. Run no daemon on a live store.
