# Cezar structural selection comparison (throwaway)

Research only, row 015-97. These scripts are not a product selector. They write
only isolated copies and this evidence directory. They never launch Cezar, a
server, a browser, an agent, or the repository's full suite.

## Fixed population

`declaration.json` was written before any baseline/outcome execution. It holds
18 existing contract tests and the first ten production-source edits in the
latest 25 commits touching `packages/contract/src` at
`991c14b9675b34ff58cd33fe16b2333752967832`. The 18 tests are the intersection
present in every selected parent. One test-only candidate is rejected and 14
older candidates fall beyond the cap. Six later-added HEAD test files are
omitted, listed in `provenance.json`. They are not a second sample.

All ten complete edits are replayed, not only their contract paths. Parent
sources are their actual git trees, not reversed patches against HEAD. The
full before/after tree manifests and exact contract/config/lockfile bytes are
in `inputs.json.gz`. Other bytes can be reproduced from the pinned git objects.
The sample omits new tests added by historical commits, even when those tests
would normally be mandatory. This is an oracle only for the fixed sample.

## Execution

Use the Cezar checkout only as a read-only git object and installed-package
source. Inspect its root and applicable nested agent instructions first.
No source file or cache under the live checkout is changed. `prepare.py`
creates tracked-source archives and copies installed dependencies into three
separate roots. pnpm relative links remain local; a live-tree symlink audit
rejects escapes. No dependency installation or upgrade runs. The pinned
package manager is pnpm 12.11.2; Vitest is 4.1.10 and Vite is 8.1.4.

Each arm starts with an allowlist environment, an empty scratch home and XDG
roots. No credentials or Cezar task context is passed. Each Vitest instance
uses the historical contract config, explicit 18-file include, Node environment,
thread pool, isolation, file parallelism off and one worker. No global server
config or other project is loaded. The source's own contract config has no
setup files. Tests are examined as pure contract/schema tests.

Three independent arms run sequentially. On even edits the order is
structural, file, exhaustive; on odd edits it reverses. The middle file arm
stays in the middle, a timing limitation. Each has a cold pre-edit run and a
warm pre-edit run. Only a passing baseline permits comparison. Coverage is
on only for the structural arm. All arms retain Squeal's input recorder.

`arm.mjs` uses the actual Squeal `importClosure` for the file baseline, plus
recorded inputs and whole config/package/lockfile fallbacks. It does not use
`vitest --related` as a substitute. This is the file-level mechanism on the
sample, not a live Squeal scheduler benchmark: stores, claims, revision races,
input growth and full environment key construction are outside the probe.

The structural arm uses Squeal's real provider and mapper. Babel 8.0.7, already
installed by Cezar, parses original TypeScript. Complete named top-level
function bodies have independent hashes; their signatures stay in a module
skeleton. Classes, arrows and nested details remain in enclosing blocks.
Comments and source locations do not affect hashes. TypeScript type syntax
is retained, so a type-only edit can conservatively broaden selection even
when Vite emits identical JavaScript. Only an exact mapped original function
span can prove a zero-hit body. Missing coverage, parse failures, changed
module skeletons and missing exact spans select the dependent file.

Selection uses exact parent source hashes and pre-edit coverage. No post-edit
coverage chooses tests. The union of all changed paths is applied once.
Changed-key file-level readers omitted by structural selection are recorded
as **stale**, never current passes. Selected results refresh coverage only
for the files actually run. This probe does not write Squeal's stores.

## Measurements and host bounds

Counts come from reporter events for each invocation, not accumulated Vitest
state. The report keeps attempted file modules, test cases, skipped cases,
collection errors and failed case identities. Missing a failed case is a miss,
including a failure inside a file that was run but did not reproduce it.

Wall time uses a monotonic clock. CPU uses Linux process/child accounting at
100 ticks/second (10 ms resolution). Warm run totals include execution and
coverage/input mapping. Selection, startup, cold runs and warm baselines are
separate. Python records process-tree CPU/wall for each full arm, including
startup and teardown; its max RSS is the cumulative child high-water mark,
not a per-arm peak. Snapshot construction is separately timed. No artificial
delays make the tests expensive.

Before each arm and each test invocation: one-minute load must be below the
24 logical CPUs and MemAvailable at least 8 GiB. The worker cap is one, below
the requested maximum of two. A gate exits 75 instead of polling. The caller
uses a bounded orchestrator timer if no preparation remains. No test process
lasts beyond the driver's 300-second bound. A run already in progress can
finish after external load rises; both endpoint loads are retained.

Three separately declared mutations on HEAD test failure detection with the
same 18 files. They do not count as ordinary historical savings. No synthetic
tests are added. Known source-reflection risks from the earlier fixture remain
outside this sample unless its own tests expose them.

## Reproduce

From this Squeal checkout, using Node 24.22.1 and the pinned Cezar git objects
and installed lockfile:

```sh
python3 docs/specifications/015-coverage-complexity/research/probes/cezar-selection/prepare.py /tmp/cezar-selection-repeat
node docs/specifications/015-coverage-complexity/research/probes/cezar-selection/dependency-audit.mjs /tmp/cezar-selection-repeat
python3 docs/specifications/015-coverage-complexity/research/probes/cezar-selection/run.py /tmp/cezar-selection-repeat
python3 docs/specifications/015-coverage-complexity/research/probes/cezar-selection/run.py /tmp/cezar-selection-repeat --regressions
python3 docs/specifications/015-coverage-complexity/research/probes/cezar-selection/audit.py /tmp/cezar-selection-repeat
```

Do not run beside another copy of this benchmark. A partial result or host
refusal is not a pass. Completed arm outputs are skipped on resume. Preserve
an interrupted arm's process log before resuming; its costs stay in the report.

`dependency-audit.mjs` compares all 169 lockfile nodes reachable from Vitest,
Babel parser and contract Zod across all 20 parent/next snapshots. Unrelated
lockfile additions do not silently change the runner. Historical source bytes
remain exact; the fixed installed dependency copy is documented explicitly.

## Retained preparation changes

The first launch stopped before creating Vitest: TypeScript 7's installed
package has no compiler API. The selector uses the already-pinned Babel
parser instead. An initial completed protocol computed structural shape
statistics in all three arms. Protocol 2 computes them only in the structural
arm. Those earlier runs are retained as pilots and are excluded from final
comparison totals; their CPU/wall still count toward total experiment cost.
The two protocols use the same selection algorithm and declared population.

Installed `node_modules/.pnpm/lock.yaml` and tracked `pnpm-lock.yaml` differ
in complete-file bytes. The dependency audit checks the relevant complete
169-node graph of the installed lock as well as every historical lock, and
requires equal hashes. It does not claim unrelated installed tools are equal.

Run `python3 .../audit.py` without an argument to reproduce `summary.json`
from the committed compressed evidence, without running tests. The audit
asserts equal per-edit parent test identities across arms, passing baselines,
actual module sets equal requested sets, structural choices contained in
file-level choices, and no unhandled errors. It compares failing case
multisets and collection-failed modules with the exhaustive sample.

Supplemental assertion diagnostics: after comparisons finish, run
`python3 .../diagnose.py /tmp/cezar-selection-repeat`. It reruns only the
oracle's failing files inside the original sample, outside comparative timing,
and retains JSON assertion messages. `failure-diagnostics.json.gz` preserves
these outputs; `audit.py` reports their CPU/wall separately. The first
interrupted comparative attempt has no retained case count, only process
CPU/wall and its host-gate error. It is not counted as a completed run.

`replay.mjs` needs `PROBE_NODE_MODULES=/tmp/cezar-selection-repeat/structural/node_modules`.
Run it with Node to independently recompute all choices from retained exact
parent inputs and records; it runs no tests. `CEZAR-LICENSE.txt` preserves the
license of source snapshots retained in the compressed input evidence.
