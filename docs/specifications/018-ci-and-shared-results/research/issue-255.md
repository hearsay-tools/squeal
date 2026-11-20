# Issue 255: import before the local environment exists

Verdict: reproduced at the store and status-formatting layer. A first import
keeps the exported key, recording the local environment does not change it, and
a second import re-keys it. The formatter prints the exact reported reason
without a re-import hint. No daemon or CLI end-to-end reproduction was run.

## Scope and evidence

| Question | Answer |
| --- | --- |
| Version | Source Squeal 0.1.578 at `9387fe8d4d3da1b3cdbda72aa7c37e05fa9ffe5c`; Node v26.13.0. The issue reports released 0.1.577. |
| Host load | Initial check: one-minute 13.53 on 24 CPUs. Probe check: 14.36 on 24 CPUs. Neither required skipping. |
| Reproduction | `verified by experiment`: one synthetic Vitest pass, separate export/local hashes, and only the permitted strict-to-focused `allowOnly` difference. |
| Owner | Spec 018 D3 (import before daemon start), D5 (reason and adoption counts), D10 (accepted differences), D11 (re-keying). |
| Limit | The probe invokes store functions and the real status formatter. It supplies the local key row rather than launching a daemon. Automatic adoption after the second import, restarts, and the separately reported long `not adopted yet` wait were not reproduced. |

## Exact commands and result

From the repository root, with installed dependencies:

```sh
uptime
getconf _NPROCESSORS_ONLN
git rev-parse HEAD
pnpm exec tsx docs/specifications/018-ci-and-shared-results/research/probes/issue-255/probe.ts
```

The probe exits 0 and prints:

```text
{"load":14.36,"cpuCount":24,"node":"v26.13.0"}
first import {"results":1,"alreadyStored":0,"closures":1,"observed":0,"startup":0,"rekeyed":0}
Imported: 0 of 1 test file current from local export at cccccccc (0 current results)
  Not current: 1 environment differs (only in fields an imported pass may differ in, but the import kept the export's keys)
second import {"results":1,"alreadyStored":0,"closures":0,"observed":0,"startup":0,"rekeyed":1}
reproduced store-level: first import retains exported key; recording environment alone leaves it; second import re-keys
```

`verified by experiment`, 0.1.578: the probe checks the stored import key after
recording the local environment and again after re-import. The first still has
the export environment; the second has the local environment. The first status
has one environment mismatch and no blocking named differences. No full suite
or background validation run was needed for this documentation-only triage.

## Source findings and decision

`read in source code`, 0.1.578: `src/core/store/transfer-rekey.ts`'s `rekeyedHash`
returns null without a local environment. `rekeyFiles` skips that file when it
cannot obtain the local hash. `src/core/store/environments.ts`'s
`recordWorktreeEnvironments` records descriptors and per-worktree hashes; it does
not rewrite imports. `src/core/scheduler/keying.ts` calls that recorder.

`read in source code`, 0.1.578: `src/core/status/imports.ts` classifies unequal
file keys as an environment mismatch when the stored environment hashes differ.
`src/core/status/import-lines.ts` adds the `ONLY_ACCEPTED` parenthetical when no
blocking differences remain. That text names the stored state but gives no
recovery command.

`inferred`: a small response is to name the re-import command once local keying
makes re-keying possible. Automatic re-keying would require choosing an owner
and trigger for retained imports and preserving D11's proof checks. The human
must choose whether to approve guidance alone or automatic recovery. Existing
holds stand; this report authorizes neither implementation.

## Sources

- [Issue 255](https://github.com/hearsay-tools/squeal/issues/255), reporter's commands and 0.1.577 output.
- `spec.md` D3, D5, D10, D11 and `status.md`, read without edits.
- `src/core/store/transfer-rekey.ts`, `environments.ts`, `transfer-import.ts`.
- `src/core/status/imports.ts`, `import-lines.ts`.
- `test/store/transfer-rekey.test.ts` and `test/cli/import-rekey.test.ts`, fixture patterns read without edits or running them.
- `research/probes/issue-255/probe.ts`, the executed throwaway probe.
