# Issue #195: a missing temporary root

Recommend a clear temporary-root setup error before collection; the reported
late failure is not reproduced in this bounded probe.

Examined 2026-11-12: installed Squeal 0.1.443 and cached shipped Squeal 0.1.440,
Node 26.13.0, Vitest 5.0.3, Linux. Documentation baseline:
`9114fdf419c2f374146fe68410915a8753b7b4b0`.
No product source was read, no product code changed, and no repository gate or
whole suite ran. Existing holds remain unchanged.

## Questions and answers

| Question | Answer and evidence |
| --- | --- |
| 1. Does host load permit a tiny live probe? | **verified by experiment**, host on 2026-11-12: initial one-minute load 18.14, 24 online CPUs. Live probe permitted. |
| 2. Does a missing TMPDIR reproduce #195? | **verified by experiment**, Squeal 0.1.443 and 0.1.440: partial symptom only. Empty stdout and an ENOENT occur, but before tests, with exit 3 rather than the reported late exit 2. Neither marker exists. |
| 3. Does an existing-root control work? | **verified by experiment**, both versions: exit 0, both markers exist, both selected files complete, stdout parses as one `squeal-code-gate/1` object with verdict `pass`. |
| 4. Is the failure actionable and classified as setup? | **verified by experiment**, both versions: stderr prints a stack trace naming `squeal-gate-policy-XXXXXX`, then says the child exited 1 without a whole report. The outer command exits 3, not D1's setup-error code 2. No create/unset instruction appears. |
| 5. Can a version difference explain the incident? | **inferred**, tested 0.1.440 and 0.1.443: not from version number alone. Both tested distributions fail at the same earlier point. The report's runtime revision and exact environment are unknown. |

## Probe and commands

Initial checks: `uptime`, `getconf _NPROCESSORS_ONLN`, `cat /proc/loadavg`.
They returned load `18.14, 16.47, 9.23`, CPU count `24`, and
`18.14 16.47 9.23 13/2366 3655412` respectively.
The installed launcher's `--version` returned `0.1.443`; the cached CLI's
`--version` returned `0.1.440`.

The throwaway [probe](../../../../research/probes/issue-195/probe.py) creates
separate fresh git repositories for missing and existing roots. Each contains
one changed function, one unchanged Vitest marker test and one unchanged
node:test marker test. Each test writes an ignored marker then asserts the
function returns 2. Both load the changed source. Fresh stores prevent reuse
from hiding execution. Dependencies come from an ignored `node_modules` symlink.
The script runs no install and starts no daemon.

Exact invocations from the worktree root:

```sh
python3 research/probes/issue-195/probe.py
python3 research/probes/issue-195/probe.py --no-base-config
ISSUE195_CLI=/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.440/dist/cli/squeal.mjs python3 research/probes/issue-195/probe.py
```

Each fixture command, from its `fixture` directory:

```sh
TMPDIR=<case>/tmp /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal code --base HEAD --json --timeout 30
# Cached 0.1.440 distribution:
TMPDIR=<case>/tmp node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.440/dist/cli/squeal.mjs code --base HEAD --json --timeout 30
```

`<case>/tmp` is an absolute generated path. It is absent in `missing` and
created in `existing`. The 30-second gate budget and 75-second subprocess bound
replace the incident's 900-second budget. `HEAD` is the fixture base, replacing
`origin/main`. The script captures stdout and stderr separately.

## Results

All six rows below are **verified by experiment** at the versions shown.
Marker columns refer to the test callback, not discovery or selection.

| Version; config at base | TMPDIR | Load 1 min | Seconds | Exit | Vitest / node markers | Stdout |
| --- | --- | ---: | ---: | ---: | --- | --- |
| 0.1.443; yes | missing | 17.31 | 0.425 | 3 | no / no | 0 bytes; not JSON |
| 0.1.443; yes | exists | 17.31 | 2.305 | 0 | yes / yes | 2,640 bytes; valid report, pass |
| 0.1.443; no | missing | 15.57 | 0.487 | 3 | no / no | 0 bytes; not JSON |
| 0.1.443; no | exists | 15.57 | 2.724 | 0 | yes / yes | 2,640 bytes; valid report, pass |
| 0.1.440; yes | missing | 14.39 | 0.441 | 3 | no / no | 0 bytes; not JSON |
| 0.1.440; yes | exists | 14.39 | 2.275 | 0 | yes / yes | 2,640 bytes; valid report, pass |

Every missing-root run left the root absent and printed this error shape:

```text
Error: ENOENT: no such file or directory, mkdtemp '<TMPDIR>/squeal-gate-policy-XXXXXX'
    at loadBasePolicy (.../dist/cli/squeal.mjs:...)
...
squeal code: the gate's process ended with exit code 1 without a whole report, so stdout stays empty
```

The stack is observed stderr, not a source-code finding. None printed the
incident's `squeal-gate-keys` warning or `coverage-.../skip.json` error. In each
control, the report lists exactly `vitest.test.mjs` and `node.test.mjs` as
selected and completed, with no failed or unfinished files. The second pair
rules out presence of the base config as the deciding factor in this fixture.

Full captured streams, marker checks and command arrays are in
[results.json](../../../../research/probes/issue-195/results.json). Generated
fixture-root paths are replaced with `<probe-root>`; no other output is changed.

## Recommendation and limits

**inferred**, Squeal 0.1.440 and 0.1.443: retain the setup-error problem for
triage, but do not describe the expensive late-run symptom as reproduced.
The deciding tradeoff is useful diagnostics before test cost. Both tested
versions already stop early here, but an uncaught stack, exit 3 and no usable
report do not give D1's setup-error classification or the issue's requested
remedy. This is evidence for the coordinator, not approval to implement a fix.

**read in official docs**, spec 020 at `9114fdf4`: D1 assigns exit 2 to usage or
setup errors; D3.5 puts temporary files under TMPDIR; D7 specifies the report
object; D11.7 reads stored evidence; D17.3 keeps completed results. The status
amendments retain those reuse and keep rules. These contracts do not establish
which internal failure path the incident took.

Open: why the reported 0.1.440 run reached store-key lookup and tests before
failing. Not determined because the exact installed revision, Node/Vitest
versions, project configuration and directory lifetime were not supplied.
Different distributions or versions may fail at different points; deletion
of a root after policy loading is also untested. The fixture uses Vitest 5.0.3
and Node 26.13.0 and does not reproduce the original 997-file project, heavy
load, harness restart or 900-second run. The two tested versions alone do not
prove a regression window or that the incident is fixed.

## Sources

- [Issue #195](https://github.com/hearsay-tools/squeal/issues/195), fetched with
  `gh issue view 195 --repo hearsay-tools/squeal --json title,body,url,comments`.
  Incident account only, not independent experimental proof. It reports 0.1.440,
  unknown revision, 989 Vitest plus 8 node:test files, and late exit 2.
- [Spec](../spec.md), D1, D3, D7, D11.7, D17.3, and [status](../status.md),
  read at `9114fdf419c2f374146fe68410915a8753b7b4b0`.
- [Probe instructions](../../../../research/probes/issue-195/README.md) and
  [captured evidence](../../../../research/probes/issue-195/results.json).
- Installed 0.1.443 launcher and cached 0.1.440 CLI paths above, executed as
  shipped; no build and no implementation inspection.
