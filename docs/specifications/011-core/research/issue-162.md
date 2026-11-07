# Issue 162: a failed hold starts its command

Recommend refusing to start the command when an existing store cannot persist
its hold. This protects measurement validity at the cost of stopping a command
that previously ran after a warning. Implementation is not authorized here.

## Verdict and scope

**Reproduced**, with the exact reported warning, on installed Squeal **0.1.414**.
The child ran with no hold row and the wrapper exited **0**. Research date:
2026-11-07. Source commit: `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`.
Node: `v24.22.1`. No product code, spec, status, skill or board changed.

| Question from the brief | Answer and evidence |
| --- | --- |
| 1. Does a locked store still permit the command? | **verified by experiment, 0.1.414**: exact warning; child marker present; zero hold rows at child start; exit 0. |
| 2. Which source path causes it? | **read in source code, 0.1.414 and 0.1.407**: `withStore` converts the write error to a string; `holdCommand` prints it and proceeds to `run`. |
| 3. How does it relate to C9/C10? | **read in source code, spec at d3f363054**: C9 promises a worktree hold and explicitly permits running without a store; it does not expressly permit running after an existing store's write fails. C10 capacity does not provide a substitute for a hold. |
| 4. What do the reported versions establish? | **read in source code, 0.1.407/0.1.414**: the relevant hold files changed only their imports. The issue reports 0.1.407 and an unspecified 0.1.41x; those incident runtimes were not replayed. The tested runtime identifies itself as 0.1.414. |

## 1. Isolated reproduction

**verified by experiment, 0.1.414.** Before either live case, the probe compared
one-minute load with online CPUs. Both readings were **17.54 / 24**, at
21:41:12Z and 21:41:13Z. The initial read during source inspection was
19.12 / 24. The probe would skip a case above 24. It used a fresh temporary Git
repository per case, with its own `.git/squeal/store.sqlite`, initialized through
this checkout's `openStore`. It started no daemon or validation runner. It held
SQLite `BEGIN IMMEDIATE` on the temporary store until the CLI returned.

| First run | Locked store | Unlocked control |
| --- | --- | --- |
| CLI elapsed time | 1,211 ms | 291 ms |
| Child stdout | `issue-162-marker` | `issue-162-marker` |
| Child marker | present | present |
| Hold rows read by child | 0 | 1, with wrapper and child identities |
| Hold rows after CLI | 0 | 0 |
| CLI exit code | 0 | 0 |

Locked-case stderr, verbatim:

```text
squeal: nothing is on hold: its Squeal store could not be written (database is locked)
```

The control reported validation on hold for at most 30 minutes. Its hold row
existed while the child ran and was removed afterward. The probe released its
own writer lock and removed both temporary repositories. Existing holds and
the shared store were untouched.

Exact first invocation (the parent then required the fixture's relocation):

```sh
pnpm exec tsx research/probes/issue-162/probe.ts /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs > research/probes/issue-162/results.jsonl
```

The final runnable command is in [the probe README](probes/issue-162/README.md).
[Raw results](probes/issue-162/results.jsonl) preserve both full CLI argument
arrays, including the harmless child's code and temporary paths. This proves
command launch without a hold; it does **not** measure competing validation or
benchmark distortion because no daemon ran in the fixture.

**verified by experiment, 0.1.414.** The relocated probe reproduced the same
outcomes at 21:43:32Z and 21:43:34Z: locked case 1,265 ms at load 15.85 / 24,
unlocked control 263 ms at load 16.02 / 24. Both exited 0. Command:

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-162/probe.ts /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs > docs/specifications/011-core/research/probes/issue-162/results-relocated.jsonl
```

The [relocated-run output](probes/issue-162/results-relocated.jsonl) records
the full evidence. All committed artifacts are under this research directory.

## 2. Source path and versions

**read in source code, 0.1.414.** In `src/cli/hold.ts`:

1. `begin` calls `addCommandHold` through `withStore`.
2. `withStore` opens the existing store with `STATUS_BUSY_TIMEOUT_MS` (1,000 ms)
   and catches thrown errors as `its Squeal store could not be written (...)`.
3. `addCommandHold`, in `src/core/scheduler/hold-rows.ts`, uses a transaction.
   `src/core/store/connection.ts` begins it with `BEGIN IMMEDIATE`.
4. Lines 73–75 turn any error string into `held === null` and print the warning.
   Line 84 still calls `run`; line 85 skips child registration with no hold.
   Line 98 returns the child's exit code.

There is no need for a timing race to reach this path. **inferred, 0.1.414**:
write contention lasting through the configured wait explains the observed
error and launch. The identity and operation of the original lock holder are
not determined by this probe.

**read in source code, 0.1.407/0.1.414.** Commands used:

```sh
git rev-parse 'squeal--v0.1.407^{commit}'
git show squeal--v0.1.407:package.json
git diff squeal--v0.1.407 HEAD -- src/cli/hold.ts src/core/scheduler/hold-rows.ts
sha256sum plugins/claude-code/dist/cli/squeal.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.414/dist/cli/squeal.mjs
```

The 0.1.407 tag resolves to `7fd4a39c9cd0e904973efb453edf3f4cf17d6d44`.
The two hold files differ only in imports. Both current CLI bundles hash to
`c44681839af3b88b9056327d1837c4bc7407c7e4b876d756991407cedfbba596`.
The probe runs the installed version's CLI directly and records its `--version`
output. The issue's `0.1.41x` is not an exact version and remains unspecified.

## 3. Contract and open questions

**read in source code, spec at d3f363054.** C9 says: “Without a store,
`squeal hold` runs the command and says that nothing is on hold.”
`test/cli/hold.test.ts` explicitly covers that fallback and a daemon refusing
the hold. The current branch conflates missing store, failed opening and failed
write. C9 also bounds waiting for cancellation at three seconds. C10's capacity
rules allow an edit's tier without a pool permit; they do not promise exclusive
host use for a held command. This finding concerns persistence failure only.

The coordinator must settle whether missing-store fallback remains permitted,
and what failure code and bounded wait apply to a persistence failure. A strict
guarantee that all validation has stopped before child launch is a separate
question involving daemon acknowledgement and cancellation; this probe does
not answer it. The exact incident lock holder and exact later 0.1.41x release
are not determined because the report supplies neither.

## Sources and verification

- [Issue 162](https://github.com/hearsay-tools/squeal/issues/162), fetched with
  `gh issue view 162 --repo hearsay-tools/squeal --json title,body,comments,url`;
  incident claims remain reporter evidence, not replayed benchmark results.
- [Current hold source](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/cli/hold.ts),
  plus the store and hold-row paths above, read from this checkout.
- [0.1.407 hold source](https://github.com/hearsay-tools/squeal/blob/7fd4a39c9cd0e904973efb453edf3f4cf17d6d44/src/cli/hold.ts),
  read through the local release tag and compared with this checkout.
- [Spec C9/C10](../spec.md), [amendments](../status.md) for rows 011-61,
  011-74 and 011-211, and [original design](../tasks/011-61/design.md).
- [Probe](probes/issue-162/probe.ts) and its raw output above. No build or full
  suite ran. This is documentation and an isolated reproduction only.
