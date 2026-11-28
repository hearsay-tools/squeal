# Issue 311: CI evidence writes enter a test's fs spy

Date: 2026-11-28. Issue: [#311](https://github.com/hearsay-tools/squeal/issues/311).

Recommendation: approve a narrow recorder-isolation repair under spec 018 D8–D9, shared recorder ownership in D24. No implementation is authorized by this research.

| Question | Answer |
| --- | --- |
| Does the reported mechanism reproduce? | **Verified by experiment:** yes. Both the current source recorder and installed Squeal 0.1.665 recorder issue one call through a later replacement of `fs.writeFileSync`, with zero application writes while the spy is installed. |
| What owns it? | **Read in source code:** spec 018 D8–D9 owns CI recording and input evidence. D24 identifies the shared evidence hooks used by both Vitest and node:test. |
| Was the merge-queue failure reproduced end to end? | No. This is a minimal Node recorder probe, without Vitest, `vi.spyOn`, a full `ci record` command, or GitHub's merge queue. It proves the shared-fs interference mechanism, not that run's scheduling. |

## Versions, load and commands

**Verified by experiment:** Node v26.13.0; checkout version 0.1.667 at `38783e11f2cb5bcb66a1df67528a89190a81cd00`; installed recorder version 0.1.665. The issue says 0.1.665 was current when reported but did not record the incident's exact version. Both tested `evidence.cjs` files have SHA-256 `9e657614bd8416f64c70c97224e84c675800aa8f5aa846d8fc07df285646b943`.

Host one-minute load was 2.05 on 16 logical CPUs for both probe runs, below the skip threshold. This bounded Node probe did not need a quiet host or load the host significantly. No test suite ran.

Exact commands from the repository root:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node --version
git rev-parse HEAD
sha256sum src/runners/ci-runtime/evidence.cjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.665/dist/ci/evidence.cjs
node docs/specifications/018-ci-and-shared-results/research/probes/issue-311/probe.cjs "$PWD/src/runners/ci-runtime/evidence.cjs"
node docs/specifications/018-ci-and-shared-results/research/probes/issue-311/probe.cjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.665/dist/ci/evidence.cjs
```

Both probes exited 0 and reported `applicationWrites: 0`, `spyCalls: 1`. The intercepted path ended in `evidence/<pid>-0-<time>.ndjson`; the payload held `e.input.txt` with hash `3f9177e45e805cac9e76b5a2131ba3484367200b` and clock field `o`. Options were `{ encoding: 'utf8', mode: 438, flag: 'a' }`, matching the append-write shape reported in the issue. The issue's clock-only payload is a different flush path; this probe deliberately forces input evidence to avoid timing dependence.

## Cause and limits

**Read in source code:** `src/runners/ci-runtime/evidence.cjs` `originals()` captures `fs.appendFileSync` before test code replaces filesystem methods. `outputOf()` calls that saved function. Its `flush()` can emit either input evidence or a clock-only line.

**Verified by experiment:** capturing `appendFileSync` alone does not isolate the recorder from later replacement of `fs.writeFileSync`. The saved append function reaches that replacement. The spy forwards to the original function, as a default Vitest spy would, so evidence is written successfully while the test observes an unexpected write.

**Inferred:** an assertion that the shared fs function was never called can fail because of recorder output alone. A repair must isolate recorder output while preserving evidence and conservative export rules. Merely saving the same append function again is insufficient. This research does not choose an implementation or establish behavior on other Node versions.

## Sources and open questions

- `src/runners/ci-runtime/evidence.cjs`: `originals()`, `outputOf()`, `createEvidence()`.
- Installed 0.1.665 `dist/ci/evidence.cjs`, byte-identical to the tested source.
- Spec 018 D8, D9 and D24.
- `research/probes/issue-311/probe.cjs` and its README.
- Issue #311 names squawk run 46105024184, job 140855775594. That external run was not re-executed or independently inspected here.

Open: the human decides whether to approve the proposed isolation repair. An implementation needs a regression with the project's real Vitest spy and a check that evidence still exports correctly; this report supplies only the bounded mechanism proof.

Duplicate context (coordinator's board/open-issue check): no exact duplicate found. #259 concerns remote `NODE_OPTIONS` recorder propagation into tests' own Node child processes; #311 concerns output from the CI recorder reaching a patched filesystem function within the same process. These mechanisms are related to instrumentation but differ in trigger and ownership.
