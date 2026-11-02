# Narrow re-review: installer release pin, 0.1.393

## Verification

Reviewed on 2026-11-02 under `tasks/tsrs-review.md`, section "Narrow re-review after CI". Prior review: `tsrs-0.1.393.md`, PASS for `8ca0eead0948e90ff70560fa9ae70e0c321f5fbe`. This review covers only the delta from that commit.

All local checks ran on the clean candidate before writing this report:

```text
git rev-parse HEAD
24a8a63b6f19f81987330e5a333e24e6ffd53ed9
git status --short
(empty)
git diff --name-only 8ca0eead0 24a8a63b6f19f81987330e5a333e24e6ffd53ed9
docs/specifications/010-ci-cost/reviews/tsrs-0.1.393.md
docs/specifications/010-ci-cost/tasks/010-34/notes.md
docs/specifications/010-ci-cost/tasks/tsrs-review.md
install.sh

git diff 8ca0eead0 24a8a63b6f19f81987330e5a333e24e6ffd53ed9 -- install.sh
-SQUEAL_VERSION=0.1.392
+SQUEAL_VERSION=0.1.393

sh -n install.sh
exit 0, no output
bash -n install.sh
exit 0, no output
git diff --check 8ca0eead0 24a8a63b6f19f81987330e5a333e24e6ffd53ed9
exit 0, no output
```

A read-only `node --input-type=module` probe extracted `SQUEAL_VERSION` and used `node:assert/strict` to compare it with the six release manifests. It exited 0:

```text
install.sh: 0.1.393
package.json: 0.1.393
plugins/claude-code/.claude-plugin/plugin.json: 0.1.393
plugins/pi/package.json: 0.1.393
plugins/opencode/package.json: 0.1.393
plugins/codex-runtime/runtime.json: 0.1.393
plugins/codex-runtime/.codex-plugin/plugin.json: 0.1.393
All six release manifests agree with install.sh.
```

The fixed Codex adapter remains at 1.0.2 with its frozen 0.1.368 seed. These are independent versions, as `plugins/codex/README.md:24,27,31` documents. They are unchanged by this delta.

### Installer affected evidence

Used the session's `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal` launcher, version 0.1.390. Its notice names installed Claude Code 0.1.392 and Codex 0.1.390; those are not the candidate checkout's version.

```text
squeal status --wait 60000 install.sh
Revision: 0
11 affected test files selected
Current (5), all pass: install-sh-opencode-update.test.ts,
install-sh-opencode.test.ts, install-sh.test.ts, update.test.ts, node-floor.test.ts
Unknown (6), nothing queued
exit 3

squeal status --wait 60000 test/cli/install-sh.test.ts test/cli/install-sh-codex.test.ts test/cli/install-sh-pi-update.test.ts test/cli/install-sh-pi.test.ts test/cli/install-sh-uninstall.test.ts test/cli/install-sh-opencode.test.ts test/cli/install-sh-opencode-update.test.ts
Revision: 0
Current (3), all pass: install-sh.test.ts, install-sh-opencode.test.ts,
install-sh-opencode-update.test.ts
Pending (4): install-sh-codex.test.ts, install-sh-pi-update.test.ts,
install-sh-pi.test.ts, install-sh-uninstall.test.ts
exit 3 after 60.8 s

Repeated the same seven-file status command:
Revision: 0
Named test files at revision 0: no known failures; 7 test files,
each with a current result, after 7.2 s.
Worktree: known failures 0; not current: 294 of 1385 test files (294 unknown)
exit 0
```

The four pending files initially waited for runs of the same keys in the parent worktree. The daemon's heartbeat was briefly stale while its socket remained alive. The second wait confirms current passing results for all seven installer suites. This includes `test/cli/install-sh.test.ts`, whose assertion at line 221 compares the installer's literal with the root package version. The two update suites not requested by name remain unverified by this review. No local full suite or checkpoint was requested. Setup was already complete. The brief excludes build and bounds this review to the installer repair; lint, typecheck and the broader compiler review were not repeated.

### CI

`gh run view 41433585897 --json headSha,status,conclusion,jobs` confirms that the prior candidate's CI failed only Node 22 shard 2/3. `gh run view 41433585897 --log-failed` identifies its one failed assertion:

```text
test/cli/install-sh.test.ts:221:56
names the release it belongs to, the root package's version
Expected: "0.1.393"
Received: "0.1.392"
Test Files: 1 failed | 469 passed (470)
Tests: 1 failed | 3756 passed | 2 skipped (3759)
```

`gh run view 41435918555 --json headSha,status,conclusion,jobs` confirms [current CI](https://github.com/hearsay-tools/squeal/actions/runs/41435918555) belongs to `24a8a63b6f19f81987330e5a333e24e6ffd53ed9`. At the final inspection it remains **in_progress**: all three Node 22 shards are in Test; the Node 24 job has completed successfully, including lint, typecheck, version-sensitive tests, build and bundle checks. All four frozen installs passed. Node 22 build and bundle checks are still pending. Full-suite CI remains **unverified**. The prior failed run is not passing evidence for this candidate.

## Verdict

**PASS 24a8a63b6f19f81987330e5a333e24e6ffd53ed9**

0 blockers, 0 should-fix findings, 0 nits. Pending CI and the stated affected-test limits are not findings. This review does not establish full-suite coverage or authorize a release.

## Blockers

None. The CI failure's version mismatch is repaired.

## Should-fix

None.

## Nits

None.

## What fits

`install.sh:40` now selects this release's tag and agrees with the package, plugin and runtime release versions. The only product change is this literal; shell control flow, download handling and public interfaces are unchanged. The prior compiler review remains applicable.

## Inputs for the next wave

No repair row is needed from this review. The coordinator must read the final outcome of CI 41435918555 before claiming full-suite coverage. Release still requires passing full-suite CI for the exact release commit and the normal release checks.
