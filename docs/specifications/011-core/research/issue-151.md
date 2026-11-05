# Issue 151: installed dependencies older than the project lockfile

Recommend investigating project-lockfile/install mismatch as a distinct diagnostic, with failure classification left for human approval.

**Verdict:** live reproduction skipped under the brief's load rule. Source inspection supports a gap between existing install provenance and the requested freshness diagnosis. It does not independently prove the reported failure or recovery. Existing holds stand; no implementation is authorized.

## Questions and answers

The brief's questions are numbered here for coverage. Source findings examine Squeal **0.1.405**, checkout **`26ffad7749a2de48e8989b4fae7d12c10d13fed6`**. Its package manager pin is **pnpm 12.15.0**; no pnpm behavior was tested.

| # | Question and method | Answer and evidence tag |
| --- | --- | --- |
| 1 | Can the isolated reproduction run within the load rule? Measure first. | No. At 2026-11-05 15:57:19.618204 UTC (16:57 Europe/Warsaw), one-minute load was **30.2548828125**, above **24 CPUs**. **verified by experiment**, host measurement only. |
| 2 | Does a changed pnpm lockfile plus an older install produce the missing bare-package failure? Isolated fixture if allowed; otherwise read issue #151. | **Not determined independently, because the load rule required skipping the fixture.** The reporter describes this on 0.1.405. Treat its causal account as **inferred**, from reporter evidence, not a run here. |
| 3 | Does a frozen install clear it, and what wording appears? Same fixture and issue. | **Not determined independently, for the same reason.** Reporter evidence gives 74 failed checks, then 53 recovered checks after `pnpm install --frozen-lockfile`, and the install sentence below. **inferred**, reported 0.1.405 sequence. These counts do not establish that every failure recovered. |
| 4 | Does existing provenance diagnose stale dependencies against the project lockfile? Read C2/C3/C5/C6 and delivery sources. | The inspected path reports no install, or that an installed lockfile changed. It makes no project-versus-installed lockfile comparison. **read in source code**, 0.1.405. |
| 5 | Do pnpm trust checks or install admission already prove that mismatch? Read C11, status amendments and install/key sources. | No such comparison occurs in these paths. Trust checks compare the installed graph with disk; admission checks whether an install exists. **read in source code**, 0.1.405. An old but internally consistent install can satisfy those checks: **inferred**, not run. |

## Reporter evidence

Fetched [hearsay-tools/squeal#151](https://github.com/hearsay-tools/squeal/issues/151) with `gh` on 2026-11-05. The issue was last updated at 15:09:32 UTC and had no comments. It reports Claude Code in a Cezar worktree, Squeal 0.1.405, a merge changing `pnpm-lock.yaml` at revision 11, and recovery at revision 12/13 after installation. No daemon restart was tried.

The issue's failure excerpt is:

```text
FAIL  74 checks with one error and location (70 tests, 4 test files that did not load)
      PASS -> FAIL, seen by Squeal's run at revision 11
      Failed to resolve import "@tailwindcss/browser?raw" from "packages/web/src/lib/report-libraries.ts". Does the file exist?
```

After the reported `pnpm install --frozen-lockfile`:

```text
PASS  53 checks recovered (FAIL -> PASS): 50 tests, 3 test files loaded
```

The reporter also quotes:

```text
These results follow a dependency install (node_modules/.pnpm/lock.yaml changed).
```

These are **reporter excerpts**, not output observed in this worktree. The issue supplies no lockfile pair, package-manager version, original fixture, or full run logs.

## Independently inspected behavior

**Install provenance — read in source code, 0.1.405.** `readLiveHeader` selects a changed path with a non-null new hash that `isInstalledLockfile` recognizes. `installSentences` prints the quoted “follow a dependency install” sentence from that path. `dependenciesInstalled` asks whether the stat cache contains any installed lockfile. Neither compares `pnpm-lock.yaml` with `node_modules/.pnpm/lock.yaml`. The installed-file list contains the latter, not the former. C2 watches this otherwise ignored input; C3 keys installed dependencies. C5 defines these two install sentences; C6 reports current/pending/stale/unknown validity. Result validity is not proof that dependencies match the intended project lockfile.

**pnpm trust — read in source code, 0.1.405.** `readPnpmInstall` reads the installed lockfile and `.modules.yaml`. Its supported graph path requires an isolated local `.pnpm` layout and a recognized lockfile. `stalePnpmLockfile` checks missing, newer, unlisted, and installed-though-skipped entries against that installed graph. `checkImporters` uses `graph.lockfile.importers`, not the project's current manifest or lockfile. When trust fails, `installedDependencies` fingerprints package folders and emits:

```text
<installed lockfile> does not describe the installed packages (<reason>); dependencies are keyed by their package.json files until pnpm rewrites it
```

That “stale” condition means installed metadata does not describe disk. It does not establish that a consistent install predates the project's desired dependencies. The 011-162 and 011-165–167 status amendments document this scope, including unsupported-layout fallback. Existing tests assert metadata/disk inconsistencies and provenance wording; they were read, not run.

**Install admission — read in source code, 0.1.405.** `missingInstall` returns no missing-install condition once the root has a recognized installed lockfile. `InstallStamps.stamp` covers installed-directory entries, manifest stats and installed-lockfile stats. It detects movement during validation, not agreement with the project lockfile. `installCommand` already selects `pnpm install --frozen-lockfile` for a pnpm project lockfile, but that helper chooses a command; it proves no mismatch.

**Recommendation — inferred from the sources above, 0.1.405.** Keep intended dependency freshness separate from installed graph trust. A later low-load reproduction should establish the mismatch and recovery before a spec defines diagnosis. The deciding tradeoff is useful environment evidence without treating an unresolved import as proof that code is correct. C5 currently keeps environment-related failures counted until evidence changes the result. Reclassification or a new hold needs a human decision.

## Commands and verification limits

The first command was the load measurement:

```sh
python3 - <<'PY'
import os,datetime
print('UTC:',datetime.datetime.now(datetime.timezone.utc).isoformat())
print('load_1m:',os.getloadavg()[0])
print('cpu_count:',os.cpu_count())
PY
# UTC: 2026-11-05T15:57:19.618204+00:00
# load_1m: 30.2548828125
# cpu_count: 24

gh issue view 151 --repo hearsay-tools/squeal --json number,title,body,comments,url,createdAt,updatedAt
git rev-parse HEAD
node -p 'JSON.stringify({version:require("./package.json").version,packageManager:require("./package.json").packageManager})'
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version
# 0.1.405

rg -n 'pnpm-lock.yaml|stalePnpmLockfile' src --glob '*.ts'
rg -n 'installedLockfile|dependenciesInstalled' src/core/delivery src/core/status src/core/types
```

No fixture was created or executed. No install, test run, full suite, build, or daemon restart was requested. This documentation-only result does not claim an affected-test pass. Source inspection, not an end-to-end run, is the independent product evidence.

## Open questions and sources

Still unknown: the original manifest and both lockfiles; the pnpm version and layout; the complete 74-check recovery; and an independently observed failure/install/recovery sequence. Also not determined: which project-versus-installed differences prove a relevant missing dependency across workspace, optional-package and filtered-install cases. A textual difference alone was not tested as such proof.

All repository paths below were read at [commit 26ffad7749a2de48e8989b4fae7d12c10d13fed6](https://github.com/hearsay-tools/squeal/tree/26ffad7749a2de48e8989b4fae7d12c10d13fed6):

- Contracts: [spec.md](../spec.md), C2/C3/C5/C6/C11; [status.md](../status.md), 011-162, 011-165–167, 011-190 and 0.1.405 release.
- Provenance: [liveness.ts](../../../../src/core/delivery/liveness.ts) `readLiveHeader` (line 48); [provenance.ts](../../../../src/core/delivery/provenance.ts) `installSentences` (141); [attribution.ts](../../../../src/core/delivery/attribution.ts) `dependenciesInstalled` (187).
- Installed graph: [environment.ts](../../../../src/core/keys/environment.ts), installed-file list (56) and `installedDependencies` (145); [pnpm-install.ts](../../../../src/core/keys/pnpm-install.ts), `readPnpmInstall` (40), `stalePnpmLockfile` (116), `checkImporters` (162).
- Admission: [install.ts](../../../../src/core/scheduler/install.ts) `missingInstall` (80); [install-stamp.ts](../../../../src/core/scheduler/install-stamp.ts) `stamp` (73); [install-command.ts](../../../../src/core/scheduler/install-command.ts) `installCommand` (29).
- Tests read only: [pnpm-install.test.ts](../../../../test/keys/pnpm-install.test.ts) (152); [provenance.test.ts](../../../../test/delivery/provenance.test.ts) (116).
