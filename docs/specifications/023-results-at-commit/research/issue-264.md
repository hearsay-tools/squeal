# Issue 264: stored red pass in a proof

2026-11-22. Recommendation: retain this as a proposed correctness investigation of side inputs and keys. Preserve valid store reuse unless the human changes that policy.

## Questions and verdict

| Question | Answer and evidence |
| --- | --- |
| Was the issue reproduced? | **Verified by experiment, Squeal 0.1.595:** not reproduced in the bounded node:test and Vitest computed-import probes. Both gave red fail / green pass on the first call, from storage on the second call, and with `--env D5_PROOF=1`. |
| Was the original incident replayed? | **Not reproduced, because** its synthetic break commit `720b74e71d37` is unavailable through GitHub (HTTP 422), and the report omits its original JSON, keys and stored records. The small probes do not reproduce the original module graph or mocks. |
| Is reading a stored red side itself a defect? | **Read in repository docs, 023 D5.1:** no. Each side uses its composed tree's key and reads a usable stored result first. A fresh run is required when that result does not cover the side's inputs. |
| Does `--env` prove the stored result was wrong? | **Read in repository docs, 023 D5.3; verified by experiment, 0.1.595:** it forces a run and prevents storage. It also changes conditions. The workaround alone does not prove a key collision or identify an omitted input. |
| Is test-side copying established as the cause? | **Inferred:** no. The recovered command explicitly marks `built-in-run-slots.ts` as `--source`, so the positional-helper explanation for #256 is not established here. |

## Original evidence and ownership

**Read in GitHub report:** [#264](https://github.com/hearsay-tools/squeal/issues/264) reports Squeal 0.1.595 reading a stored pass for the red side. [Squawk #4080](https://github.com/hearsay-tools/squawk/pull/4080), Verification, supplies this more complete command at head `7181de384`:

```sh
squeal proof packages/cezar/src/index-run-slots.test.ts --base 720b74e71d37 --case source --source packages/cezar/src/built-in-run-slots.ts --env D5_PROOF=1
```

It reports `1 proven` with red `expected [ true, false ] to deeply equal [ true, true ]`; without `--env`, it reports a stale stored pass. These are reporter claims, not replay results. The test fetched at `7181de384` uses `vi.resetModules()`, mocks dispatch, and calls `await import(entry)` for four entry paths. **Inferred:** a key missing a runtime import is a plausible investigation target, not a proven cause.

**Read in source code, checkout 0.1.596 at `c3ddb7841efd133df5b4a6ad010e574f3833f351`:** `src/cli/proof-side.ts` accepts stored records only when the checkout has no detected change, no forced condition applies and the records are reusable. `src/core/commit/at-keys-side.ts` keys a temporary composed side. `src/core/proof/sides.ts` keeps explicit `--source` paths on the code side. These describe the intended boundary; they do not establish completeness of the original side's inputs.

Spec owner: 023 D2 (keys), D5.1 (store reuse), D5.2 (side composition), D5.3 (conditions), D5.5/D5.6 (verdict and exit), D7.6 (commit-daemon proof sides), and Testing. Related #256 concerns helper classification; #257 concerns explicit spawned-script inputs. Neither establishes this stored-pass symptom. A peer reported a possible static-before-observation key defect during 023-42 work; that report is unverified here and must be checked against its own test evidence. Existing holds stand.

## Live probe evidence

**Verified by experiment:** the controller host had 16 online CPUs. Load was 8.39 at research intake, 7.87 before the node:test launch, and 8.93 before the Vitest launch, all below the required skip threshold. `cat /proc/loadavg` and `getconf _NPROCESSORS_ONLN` supplied these readings. Live probes ran on the task-owned boat.dev sandbox `bx_bsxz9eww`, created without stored account secrets and deleted after evidence collection. No product checkout was installed or tested on the controller host. Cleanup used `boat delete bx_bsxz9eww --yes --json`; `boat deletion status bdop_2c5098f27de9458caec15c8f2284a272 --json` confirmed `status: completed`.

Boat used Node `v24.22.1`, 4 CPUs, and the shipped Squeal `0.1.595` CLI copied from the session runtime. Node:test launch load was `0.41 0.28 0.11`; Vitest launch load was `0.22 0.26 0.11`. The repository checkout was 0.1.596; it was not the tested CLI.

The [throwaway node:test script](probes/issue-264/probe.sh) creates a dependency-free repository. The [Vitest script](probes/issue-264/probe-vitest.sh) uses Vitest 5.0.3, this Squeal repository's development version; the original Squawk Vitest version was not determined. An initial Vitest 4.1.10 install was replaced with 5.0.3 before any Vitest proof ran. Each unchanged test computes an import path; base exports 1, head exports 2, and the test expects 2. Explicit `--source` preserves the intended changed product bytes.

| Variant | First proof | Second proof | Conditioned proof |
| --- | --- | --- | --- |
| node:test | proven; red fail/run, green pass/run; 2 runs | proven; red fail/store, green pass/store; 0 runs | proven; red fail/run, green pass/run; 2 runs, not stored |
| Vitest 5.0.3 | proven; red fail/run, green pass/run; 2 runs | proven; red fail/store, green pass/store; 0 runs | proven; red fail/run, green pass/run; 2 runs, not stored |

All six commands exited 0. Both conditioned reports also read the unconditioned red failure from storage and say the conditions are not shown to matter. The table records the relevant JSON fields; full generated reports were not retained. These are six targeted proof results, not full-suite evidence.

## Commands

Source retrieval:

```sh
gh issue view 264 --repo hearsay-tools/squeal --json body
gh issue view 4080 --repo hearsay-tools/squawk --json body --jq .body
gh api repos/hearsay-tools/squawk/contents/packages/cezar/src/index-run-slots.test.ts?ref=7181de384 --jq .content | base64 -d
gh api repos/hearsay-tools/squawk/commits/720b74e71d37
```

The last command returned HTTP 422, `No commit found for SHA: 720b74e71d37`.

Sandbox execution (`<runtime-dist>` is the session's shipped 0.1.595 `dist` directory; no credential values were copied):

```sh
boat new --no-env --no-snapshots --ttl 1200 --name issue-264-proof --json
boat push bx_bsxz9eww <runtime-dist> --to /home/user/squeal-dist --json
boat push bx_bsxz9eww docs/specifications/023-results-at-commit/research/probes/issue-264 --to /home/user/issue-264 --json
boat exec bx_bsxz9eww --detach -- env SQUEAL_CLI=/home/user/squeal-dist/cli/squeal.mjs bash /home/user/issue-264/probe.sh
boat exec bx_bsxz9eww --detach -- bash -lc 'mkdir -p /tmp/issue-264-vitest/repo; cd /tmp/issue-264-vitest/repo; npm init -y >/dev/null; npm install --save-dev --save-exact vitest@4.1.10 >/tmp/issue-264-vitest/install.log 2>&1'
boat exec bx_bsxz9eww --detach -- bash -lc 'cd /tmp/issue-264-vitest/repo; npm install --save-dev --save-exact vitest@5.0.3 >/tmp/issue-264-vitest/install-5.log 2>&1'
boat exec bx_bsxz9eww --detach -- env SQUEAL_CLI=/home/user/squeal-dist/cli/squeal.mjs bash /home/user/issue-264/probe-vitest.sh
```

The scripts contain the exact fixture setup and proof commands. For each framework they run `checks`, then the same proof twice, then with `--env D5_PROOF=1`; each proof has `--case source --source src/value.<ext> --timeout 90 --json`. Node base/head: `8aa3522c2a546abe2d28c7e58f34044603e1a74d` / `3f90381ce18d87287e05da35357eba6a81ba93e5`. Vitest base/head: `bf8c6209665b63220ba353c5889e194e9932c0f6` / `4f523e127ceabb3f8f6b7bed699d4036bfb882c0`.

## Human decision

Approve a focused investigation of stored proof inputs and side keys, checking whether 023-42 already covers this case, or defer until the original break tree and JSON are available. Done when a red side cannot reuse a pass whose recorded inputs differ from its composed tree, and a regression case covers the runtime-import/store path with correct provenance. Whether to replace store-first behavior with mandatory fresh red runs is a separate policy choice; these negative probes do not justify that change. No implementation is authorized by this report.
