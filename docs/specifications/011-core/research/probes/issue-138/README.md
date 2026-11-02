# Issue 138 throwaway probes

These are research fixtures, not product tests or a proposed fix. Run from the
repository root with installed dependencies. Each probe checks one-minute host
load against logical CPU count before starting live work. It skips above that
count. Never lock the project's own store.

`live.mjs` creates a private Git repository and runtime directory, links the
existing dependencies, and starts one real bundled daemon. One test reads two
source files. After a passing baseline, it holds `BEGIN IMMEDIATE` on that
fixture's store for 12 seconds, saves each source, and asks for a selected
verdict while locked and after release. Finally it changes the test to assert
both new values. It stops its own daemon and removes its private fixture.
The manifest is a stub (declares Vitest 4.1.0); the linked installed runtime was
Vitest 5.0.3. No install ran. The captured dependency-lock fallback note is part
of this artificial environment.

`refinement.probe.ts` uses the repository's real scheduler, real SQLite and its
five-file Vitest fixture. It pauses the first new closure, stores two additions
as separate revisions, takes a separate process's 3-second writer lock, then
releases the closure. It sets the scheduler connection's busy timeout to 100 ms
instead of production's 5 s. It measures the state after release and after one
later edit. Its passing assertions confirm the missing key; they do not certify
correct product behavior. The config restricts Vitest to this single research
probe, which the project's normal Squeal coverage excludes.

Commands used (Node v24.22.1, pnpm 12.15.0):

```sh
node --check docs/specifications/011-core/research/probes/issue-138/live.mjs
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-138/live.mjs > docs/specifications/011-core/research/probes/issue-138/live-output.jsonl 2>&1
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-138/live.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.390/dist/cli/squeal.mjs > docs/specifications/011-core/research/probes/issue-138/live-0.1.390-output.jsonl 2>&1
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-138/refinement.config.ts docs/specifications/011-core/research/probes/issue-138/refinement.probe.ts > docs/specifications/011-core/research/probes/issue-138/refinement-output.txt 2>&1
SQUEAL_PROBE_BUSY_MS=5000 SQUEAL_PROBE_HOLD_MS=35000 pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-138/refinement.config.ts docs/specifications/011-core/research/probes/issue-138/refinement.probe.ts > docs/specifications/011-core/research/probes/issue-138/refinement-production-output.txt 2>&1
```

The CLI probe prints each selected JSON payload, elapsed time and process exit
code. The refinement probe writes `refinement-observations.jsonl` directly;
Vitest 5 hides successful test console output. The final refinement run took
11.91 s: one probe passed, zero skipped. Earlier exploratory runs first used
lookup-only and then added direct observation capture; retained output is the
final run with all five baseline files current. No full repository suite ran.

Only the scripts, README and observations are committed. Fixture stores and
`node_modules` are not committed. The findings file distinguishes these
controlled runs from the original incident.

The production-timeout attempt was not reproduced, because one-minute load
was 24.49 on 24 CPUs. It skipped before fixture creation; no lock was taken.
`refinement-production-observations.jsonl` and `refinement-production-output.txt`
retain that skip. Do not count it as a passing production-timeout probe.

Captured text logs have trailing blank lines removed. `git diff --cached --check`
passed after that trim. Biome ignored these research paths, so its formatting
command processed no files and supplies no check evidence.
