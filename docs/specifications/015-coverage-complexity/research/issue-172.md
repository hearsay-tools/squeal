# Make one-shot selection explicit before setup, with honest coverage scope

Recommendation: define a scoped one-shot selection contract and show its selection
before setup; do not call selected evidence global complete coverage.

## Verdict and questions

The CLI limitation is supported by source, but the reported browser-start incident
is **not fully reproduced**. Broad custom `inputs` alone did not select the browser
stand-in. The report's attribution to those inputs is not established.

Examined on 2026-11-10: reported and probed Squeal **0.1.426**, source commit
`6bb387fec689dd80bd68cfb04f6bbea2153a3c23`, Node **24.22.1**, Vitest **5.0.3**.
The runtime report records counter 4, coverage provider 3, coverage record 4 and
quality policy 2. Each tag below applies to these versions unless stated otherwise.

| Question | Answer and evidence tag |
| --- | --- |
| 1. Does a manual browser group with broad custom inputs run for a source edit? | **verified by experiment:** custom inputs alone selected only the server test. **read in source code:** the collector applies no manual-group filter. A browser test returned by `affected()` is eligible. The original selection cause is **not determined**, because the external config/import graph was not inspected and further live cases hit the load limit. |
| 2. Does `--test` replace automatic selection? | **read in source code:** no. It adds named tests, then adds both direct and transitive affected tests to the same map. The live explicit-server case was skipped. |
| 3. Is selection visible before setup? | **read in source code:** no Squeal selection summary is emitted between selection and adapter execution. The CLI writes its report only after collection. A marker-order experiment is **not determined**, because the only executed case did not run setup. |
| 4. Can four passing server files establish complete coverage despite 299 pending loaders? | **read in official docs** (repository specs): not by count alone. Spec 015 D9 preserves missing-loader uncertainty, with defined conservative upper-bound pass exceptions. Spec 020 D5 evaluates selected evidence under its own completeness rules. **inferred:** a future narrow run must state its scope; it cannot assert global completeness merely by dropping other loaders. |

## Experiment and exact commands

Read the report with:

```sh
gh issue view 172 --repo hearsay-tools/squeal --json title,body,url,comments
date -u '+%Y-%m-%dT%H:%M:%SZ'
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
node research/probes/issue-172/probe.mjs
```

At 16:10:34Z the one-minute load was **14.25**, CPU count **24**. At probe start,
16:12:11Z, load was **23.01**. After the first case it was **28.85**. The script
therefore skipped `direct-loader`, `direct-loader-explicit-server` and
`root-setup-custom-input-only`. It finished at 16:12:13Z. No retry under high load.

The isolated Git fixture defines a server test importing `src/math.ts`, and a
browser-named Node test with no import of that source. Policy assigns the latter
to `at: "manual"` and declares `inputs: { "test/browser.test.ts": ["src/**"] }`.
Its global setup only writes `browser-setup` to `marker.log` and
`ISSUE172_BROWSER_SETUP` to stderr. Changing `double` from `x * 2` to `x + x` runs:

```sh
/home/agent/.nvm/versions/node/v24.22.1/bin/node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs code --base HEAD --timeout 30 --json
```

**verified by experiment:** exit **0**, verdict `pass`; selected and completed:
`["test/server.test.ts"]`; failures and not-finished lists empty; stderr and marker
empty. The changed function has CC **1**, CRAP **1**, own lines **2/2** covered;
expected and measured loaders contain only the server file. Runner duration:
**561 ms**. This is the CLI's result for its selected evidence, not proof that all
policy-declared loaders ran. The full JSON and fixture generator are committed in
`research/probes/issue-172/`.

## Source findings and deciding tradeoff

**read in source code:** `src/core/code/gate/collect.ts:121` loads policy, opens
adapters, selects, then runs. It never reads `policy.checks`. Its Vitest options
honour `vitest.exclude` and `excludeProjects`, but pass no custom-input expansion.
`select` at line 205 unions named paths/tests with `affected.direct` and
`affected.transitive`. This implements spec 020 D3.1's “plus `--test` files”.
It provides no per-command replacement or project filter. Path narrowing limits
changed sources; it does not filter their loaders by group.

**read in source code:** `src/runners/vitest/adapter.ts:487` delegates affected
selection to `affectedTestFiles`; that implementation at `affected.ts:29` walks
imports and project environment inputs. Adapter `closure()` at line 499 supplies
import/snapshot paths. By contrast, daemon closure assembly explicitly adds
declared inputs in `src/core/keys/closure.ts:176–200`. Thus the stored daemon report
and the one-shot report need not have the same loader set. This explains why
the experiment does not prove the reported broad-input mechanism.

**read in source code:** `src/cli/code-gate.ts:259–273` awaits collection before
printing either text or JSON. `collect.ts:124–135` has no output of selected files
before `adapter.run`. `src/runners/vitest/run.ts:88` invokes Vitest's
`runTestSpecifications`. In installed Vitest 5.0.3,
`dist/chunks/index.DpLw24bj.js:21282–21286`, `initializeGlobalSetup` includes both
selected projects **and the root project**; line 12180 invokes setup functions.
**inferred:** a root-level environment setup is a separate possible cause of
browser infrastructure starting even when no browser test is selected. It is not
proven to be the cause in Cezarion.

**read in official docs:** spec 019 D1 says manual groups run “never on [their]
own”; D6 names `squeal run <group>` and distinguishes a narrow run from making the
whole group current. Spec 020 D1/D3 makes `code --base` an explicit fresh run with
automatic affected selection; it does not define how that command relates to
manual groups. Spec 015 D7 governs Stop blocking, not this one-shot gate. D8/D9
require current coverage provenance, and D9 permits only specified early passes.
These contracts need a scoped decision, not an assumption that `manual` already
excludes a group from every explicit command.

**inferred recommendation:** the deciding tradeoff is narrower execution cost
versus the strength and scope of the coverage claim. Approve a selection and
pre-setup visibility contract under spec 020, coordinated with 019 D1/D6 and
015 D8/D9. Preserve omitted-loader information and explicit uncertainty. This
research selects no flag design and changes no existing policy.

## Limits, open questions and sources

- Probe validation: `node --check research/probes/issue-172/probe.mjs` passed;
  `pnpm exec biome check research/probes/issue-172/probe.mjs` passed after formatting
  and import sorting; `git diff --check` passed. The first affected-status wait
  exited 3 after 61 s: `test/policy/repository-inputs.test.ts` was queued for the
  lane's 120 s quiet delay. The probe has no test loader; Squeal therefore reports
  its functions as untested. Its direct CLI execution above is the research check,
  not a claim of suite coverage. No policy was changed to suppress those notices.
  A second identical wait also exited 3, after 60.7 s, with the same test queued
  for CPU (14/24 cores in use, Squeal slots 6/12), zero known test failures, and
  9 tests plus 1 test-file check not current. Command:
  `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-172/.gitignore research/probes/issue-172/probe.mjs`.
  This affected check remains pending; no suite pass is claimed.
- The original `--base 819ec5af0 --timeout 600 --json` command, four passing
  regression files, 100 browser files and 299 waiting loaders are issue claims,
  not independently replayed evidence. No external repository was edited.
- The three remaining probes were load-skipped. No real browser, server, full
  suite, build or new daemon was started. Root setup and actual import reach in
  Cezarion remain the evidence needed to settle the incident's cause.
- Human decision: how should an explicit scoped gate treat omitted manual
  loaders, and what verdict may it give? Does setup live at the root, in the
  selected browser project, or in config evaluation in the reported repository?
- [Issue 172](https://github.com/hearsay-tools/squeal/issues/172), fetched with `gh`.
- Local repository specs: `015-coverage-complexity/spec.md` D7–D9 and `status.md`;
  `019-run-triggers/spec.md` D1/D6 and `status.md`;
  `020-quality-gate/spec.md` D1/D3/D5 and `status.md`.
- [Pinned Squeal source](https://github.com/hearsay-tools/squeal/tree/6bb387fec689dd80bd68cfb04f6bbea2153a3c23), paths and lines cited above.
- Installed dependency source: `node_modules/vitest/dist/chunks/index.DpLw24bj.js`,
  version from `node_modules/vitest/package.json`; package reference
  <https://www.npmjs.com/package/vitest/v/5.0.3>. The package URL is identification;
  the source read was the installed file, not a fetched web page.
