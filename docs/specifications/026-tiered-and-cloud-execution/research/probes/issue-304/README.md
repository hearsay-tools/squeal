# Issue #304 throwaway probe

Run from the repository root:

```sh
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-304/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-304/results.jsonl
```

The script uses the real remote lane, runner-host protocol, Git sync eligibility,
blob proof and tree host over in-process streams. Runner discovery and completed
reports are synthetic; no browser, provider, SSH, daemon or test suite is started.
Fixtures use temporary directories and are removed in `finally`. No install is
needed beyond this checkout's existing dependencies. Do not ship this as a test.

Recorded source: `7ac351b33440b7bcdb16643993c65cec6e2b77bb`, package 0.1.659,
Node v26.13.0. Final command exit 0 in 0.635 s reported tool wall time, eight
scenarios asserted. `results.jsonl` records one-minute load 0.35, 16 online CPUs.
The probe refuses to run if the one-minute load exceeds the CPU count.

The first development run exited 1: its assumption that retry removes a new
remote-only file was false. `existsAtRunStart` was `[false,true]`, not
`[false,false]`. Inspection found the synced-file ledger guard in
`tree-host.ts:remove`. The final probe asserts that behavior, including a case
where the remote creates the file only once, and contrasts a previously synced
file whose local deletion is repaired (`[true,false]`). The output above is the
final run, not a passing product test suite.

The runtime case calls the real `RuntimeFiles.classify/effective` with an
unprotected exact rule and records the exclusion, separately from the lane's raw
observed-input proof. It does not instantiate the scheduler or load a real
project config. The written-directory case supplies `ObservedInputs.written`;
it does not exercise browser recorder attribution. Artifact extensions stand for
bytes in proof; the `.png` is text, and no image or JavaScript is executed.
