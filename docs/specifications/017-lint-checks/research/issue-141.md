# Issue 141: an old pinned runtime cannot run oxlint

Keep session pinning and make the oxlint runtime requirement explicit: use a new session on Squeal 0.1.392 or later.

Research on 2026-11-03 for [issue 141](https://github.com/hearsay-tools/squeal/issues/141). Documentation only. Spec baseline: `origin/main` at `e698efd14cf5387c76455072dd5dbee2e335e7cc`. The issue's exact repository config was not supplied; the experiment uses the smallest oxlint-only config.

## Questions answered

| Question | Answer | Evidence tag and version |
|---|---|---|
| 1. Does 0.1.390 reject `lint.tools` and disable oxlint-only validation? | It **ignores the key**, reports it, and continues with its ESLint-only implementation. With no ESLint installed, lint reads off. It does not reject the whole config or terminate validation. | **verified by experiment**, Squeal 0.1.390, Node 24.22.1, oxlint 1.90.0 |
| 2. Does 0.1.392 support the same config? | Yes. It records the oxlint violation at revision 0 and a current pass after the fix at revision 1, without restarting the daemon. | **verified by experiment**, Squeal 0.1.392, Node 24.22.1, oxlint 1.90.0 |
| 3. Is staying on 0.1.390 despite another installed 0.1.392 plugin expected? | Yes. The launcher gives the session pin precedence. Spec 002 D7–D9 requires that identity to remain stable. The original machine's installation and pin history were not examined. | **read in source code**, 0.1.390 launcher; **read in official docs**, spec baseline above |
| 4. What do current advisories establish? | The old reader names the ignored key and its own version, and tells the user to update and restart the session. It cannot identify this unknown key's minimum version or which tool was lost. | **verified by experiment**, 0.1.390 output; **read in source code**, 0.1.390 and 0.1.392 compatibility reader |

## Findings

### 1. The reported lint-off state is reproducible

**Verified by experiment, 0.1.390.** A scratch Git repository contained one file, `const unused = 1;`, oxlint 1.90.0, no ESLint, and this policy:

```json
{"lint":{"enabled":true,"tools":["oxlint"]},"complexity":{"enabled":false},"coverage":{"enabled":false}}
```

The oxlint config enabled `no-unused-vars` at error severity. The independent oxlint CLI returned exit 1 with `eslint(no-unused-vars)`. Squeal returned:

```text
Lint: off: no ESLint installed in <scratch>/0.1.390/project.
Not applied: squeal.config.json key "lint.tools" is unknown to squeal 0.1.390, the version that read it here: a typo, or a key a newer Squeal added. Validation goes on without it.
```

The full line continues with `setup --check`, `update`, and the session restart requirement. JSON contains `configProblems: ['unknown key "lint.tools"']` and `ignoredConfig: [{key: 'lint.tools', by: 'command', version: '0.1.390'}]`. `lint.files` is 0 and `lint.off` names absent ESLint. The command reports the unknown key even in the first snapshot before a store exists.

**Read in source code, 0.1.390.** `policy-lint.ts` allows only `enabled`, `include`, `exclude` and `blocking`. `cli/daemon.ts` supplies only `eslintProvider`. Thus the key does not itself switch lint off: unsupported oxlint plus absent ESLint explains the state. Removing `tools` cannot add an oxlint provider to this runtime.

### 2. The same project works on 0.1.392

**Verified by experiment, 0.1.392.** The isolated daemon reports one lint file and one failure, with no `configProblems` or `ignoredConfig`. `lint a.js --json` names `tool: "oxlint"`, `outcome: "fail"`, and the same rule, message, severity, line 1 and column 7 as the direct CLI. Replacing the file with `export const used = 1;` produces `outcome: "pass"`, no findings, `stale: false`, revision 1. Status reports zero pending, stale and unknown lint checks.

**Read in source code, 0.1.392.** `policy-lint.ts` accepts an array of `eslint` and `oxlint`; the daemon supplies both providers. This is a selector for supported tools, not arbitrary custom commands. Spec 017 D11 states that `lint.enabled` enables installed supported tools and `lint.tools` narrows them. D8/D9 define the output and off states. Lint remains off by default under D1. Type-aware oxlint remains outside the first implementation under D11; this probe used native rules only.

### 3. Pinning and diagnostics are distinct from tool support

**Read in source code, 0.1.390.** The launcher reads the session record, validates that version's retained runtime, and selects `pinned ?? ...`. It prints the reported “this Codex session started on … and keeps it until it restarts” notice when the installed newest version is ahead. A missing pinned runtime is an error, not permission to choose another version.

**Read in official docs, origin/main `e698efd14`.** Spec 002 D8 says an update applies to new sessions only; D9 says later hooks use the pinned version. Spec 005 D3 documents the version-skew advisory and defers to 002 for the runtime lifecycle. The more specific ignored-key implementation belongs to 011-275, not a new 005 policy.

**Read in source code, both releases.** `core/status/ignored-config.ts` has known introduction/cost metadata only for `runtimeFiles`. Unknown keys use the reader's version and generic guidance. It has no `lint.tools` minimum-version metadata. **Inferred:** the existing diagnostic prevents a claim that lint passed, but does not establish that configured oxlint checks will run before work begins. A compatibility requirement is separate work from the released oxlint provider; this research does not define its implementation.

## Method and limits

- Release commits: 0.1.390 `5d93ab1720d4e457739168e8b59cf2ae113f22c1`; 0.1.392 `56764d5455ddae8e9090a6492dc3959574d13cc9`.
- Ran committed `plugins/claude-code/dist` bundles extracted with `git archive`, without a build. Their CLI blobs are identical to `plugins/codex-runtime/dist/cli/squeal.mjs` at each tag: respectively `475df6f96f7a5cdd5a78be407e4cca0b8ad69433` and `f5eb36f0a519712fe5c806f6e94878ff46f88099`. This tests runtime behavior, not a live Codex registration or launcher invocation.
- Linux, Node 24.22.1, oxlint 1.90.0, 24 CPUs (`getconf _NPROCESSORS_ONLN`, `nproc`, Python `os.cpu_count`). Initial load was 8.46; final probe gates were 4.52 and 4.80, below 24. The full three load averages are preserved. No performance conclusion follows.
- Separate scratch repositories under `/tmp`; isolated `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `TMPDIR`; no inherited plugin/session variables. Only the existing oxlint package was linked, read-only. No install, full suite, build, release, live-store access, plugin/config change, or hold change.
- A preliminary attempt inherited Cezar's temporary directory beneath the source repository. That permitted ancestor dependency resolution, so it was stopped and discarded. The final script explicitly uses `/tmp`. No result from the preliminary attempt supports a finding.
- The fixtures have no test runner or lockfile. Test status reports `awaitingInstall` and incomplete listing. Both bounded `status --wait 3000` calls exited 0 **on timeout**, not a test verdict. Lint evidence comes from the stored per-file outcomes. The issue's 60-second wait duration was shortened to avoid waiting on an irrelevant test listing.
- Both final daemons exited 0 after SIGTERM, their process groups disappeared, and scratch directories were removed. A final process listing found no probe Node process. This verifies cleanup, not the project's test suite.

## Recommendation and open questions

**Inferred from questions 1–4:** preserve the session pin. State that this oxlint config needs a runtime with the 0.1.392 feature, available in a new session after installing that runtime. The tradeoff is stable runtime identity versus access to a newly added check. The source and experiment favor an explicit compatibility requirement over silently switching an active session.

Not determined: the original cezarion config's exact tool values, whether a fresh session on that machine selects a complete 0.1.392 runtime, or how its real config behaves. No plugin update, session restart, hook delivery, mixed-version daemon case, or type-aware lint was tested. Whether to require config-version metadata or strengthen registration is a human/spec decision. Existing holds remain unchanged.

## Sources and reproduction

- [Issue 141](https://github.com/hearsay-tools/squeal/issues/141), fetched with `gh issue view 141 --repo hearsay-tools/squeal --json title,body,url,comments`.
- [0.1.390 source](https://github.com/hearsay-tools/squeal/tree/5d93ab1720d4e457739168e8b59cf2ae113f22c1) and [0.1.392 source](https://github.com/hearsay-tools/squeal/tree/56764d5455ddae8e9090a6492dc3959574d13cc9): `src/core/daemon/policy-lint.ts`, `src/cli/daemon.ts`, `src/core/status/ignored-config.ts`, `plugins/claude-code/bin/squeal-launcher`, fetched through `git show <tag>:<path>`.
- Specs at the recorded `origin/main`: [017](../spec.md) D1/D8/D9/D11 and [status](../status.md); [002](../../002-codex-adapter/spec.md) D7–D9; [005](../../005-agent-adoption/spec.md) D3. Read through `git show origin/main:<path>` with their status logs.
- [Throwaway probe and exact commands](probes/issue-141/README.md), [script](probes/issue-141/probe.py), [captured output](probes/issue-141/results.json).
