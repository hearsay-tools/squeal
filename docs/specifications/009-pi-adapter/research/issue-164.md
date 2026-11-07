# Issue 164: repeated Pi missing-consumer notice

Recommend a bounded change to the Pi status notice that suppresses unchanged repeats and explains the missing automatic feedback; preserve its existing install guidance and registration uncertainty.

Examined Squeal **0.1.414**, commit `b509d603f483e5b869eb11b6cfecc744b057193e`, Node **24.22.1**, on 2026-11-07. No Pi binary or model ran. The incident version is unknown: #164 names 0.1.412 as current when reported, not as the observed binary. All findings below concern this checkout unless stated otherwise.

## Questions answered

| Question from the brief | Answer and evidence tag |
| --- | --- |
| 1. Does unchanged `status` repeat the notice with `PI_SESSION_ID` and no consumer? | Yes: three separate processes over one unchanged store; also two calls without a store. **verified by experiment**, 0.1.414. |
| 2. Does current wording explain installation and effect? | It gives installation and restart instructions, and allows delayed registration. It does not explain missing automatic reports or idle exit. **verified by experiment**, 0.1.414. |
| 3. What still works, and can the daemon exit? | A status snapshot remains available without a consumer. Automatic Pi delivery requires the extension. A daemon with no consumers can exit under existing lifecycle rules; the notice alone cannot prove when. Snapshot: **verified by experiment**; delivery/lifecycle: **read in source code**, 0.1.414. |
| 4. Is this the #85/#131 version-warning mechanism? | No. This is CLI status stdout; the launcher version notice uses stderr and `launcher-notices.json`. **read in source code**, 0.1.414. The original #131 cause is not determined here. |

## 1. Reproduction

**verified by experiment — Squeal 0.1.414.** Initial host check was 15.92 one-minute load / 24 CPUs. The probe rechecked before each CLI process: **14.95 / 24**, all below the limit. It ran at 22:46 Europe/Warsaw (21:46Z), in about two seconds including setup. Full argv, output and exit codes are in [output.jsonl](probes/issue-164/output.jsonl); [probe.ts](probes/issue-164/probe.ts) contains the assertions.

Exact invocation from the worktree root:

```sh
pnpm exec tsx docs/specifications/009-pi-adapter/research/probes/issue-164/probe.ts > docs/specifications/009-pi-adapter/research/probes/issue-164/output.jsonl
```

Each child ran `/home/agent/.nvm/versions/node/v24.22.1/bin/node --disable-warning=ExperimentalWarning <repo>/plugins/pi/dist/cli/squeal.mjs status`, from `<scratch>/project`, with `PI_SESSION_ID=issue-164-synthetic`. The child environment was constructed from PATH plus private HOME, TMPDIR and XDG_STATE_HOME; no inherited harness identity or credentials. `<repo>` and `<scratch>` are log substitutions, defined in the [probe README](probes/issue-164/README.md).

| Case | Calls | Result |
| --- | ---: | --- |
| No store, same session | 2 | Identical notice each time; exit 1, status unavailable |
| One revision, no consumer, same session | 3 | Identical notice each time; exit 0, revision 1 snapshot |
| `status --json`, no consumer | 1 | Parseable available snapshot, no notice; exit 0 |
| Empty `PI_SESSION_ID` | 1 | No notice; exit 0 |
| Matching consumer seeded | 1 | No notice; exit 0 |
| Different session after registration | 1 | Notice names the other session; exit 0 |

All nine children had empty stderr. Store inspection after the absent-consumer calls found zero consumers: pulling status did not register one. Assertions passed, command exit 0. The fixture had no tests, daemon, Pi process or delivery history. No test suite was run and no shared daemon was changed.

## 2. Wording and cause

**verified by experiment — Squeal 0.1.414.** Every repeated line was:

> Pi: no Squeal consumer is registered for this session in this worktree (PI_SESSION_ID issue-164-synthetic). Either the Squeal Pi extension is not loaded in it, or it has not registered the session yet: a session that started before the store existed registers at its next tool call. Without the extension, install it with pi install &lt;repo&gt;/plugins/pi, then start Pi again.

Installation is already covered. The line does not say that automatic test reports are absent while CLI snapshots remain available. It also does not mention daemon idle exit.

**read in source code — Squeal 0.1.414.** `src/cli/pi/status.ts:52–70` checks the session against consumers of the current worktree on each call. It has no told-state or marker. A matching record returns silence. An empty identity or unreadable store also returns silence; no store produces the notice. `piInstallCommand` chooses `pi install <package>` for a `squeal-pi` manifest, otherwise the existing `curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh` command. The latter path was read, not executed. `src/cli/main.ts:306–342` appends the notice to the ordinary human snapshot; JSON, named paths and waits take other branches. This finding does not claim every status variant repeats it.

## 3. Effect and lifecycle

**read in source code — Squeal 0.1.414; read in official docs — repository specs at the examined commit.** Spec 009 D2/D3 assigns registration and tool-boundary reports to the extension. D7 requires this notice and its install command, but does not require once-per-session suppression. Spec 011 C8 defines the shared delivery contract; D8 retains core daemon lifecycle rules. Without the extension, its automatic reports and idle wake do not run. The successful snapshot in section 1 demonstrates that CLI state access does not require that consumer.

**read in source code — Squeal 0.1.414.** `src/core/daemon/lifecycle.ts:228–274,295–325` counts all consumers of the worktree. A daemon that never had one can exit after `daemon.idleExitMinutes` without activity; its default is 60 (`src/core/types/policy.ts:379`). A daemon that had consumers uses departure and drain rules instead. Other registered consumers can keep this case from applying. Ordinary snapshot status reads do not create a consumer or ensure a daemon (`main.ts`, `src/core/status/open.ts`). Thus “may exit when idle” is supported; “will exit in 60 minutes because this Pi extension is absent” is not. No live idle-exit experiment was run.

## 4. Difference from version notices

**read in source code — Squeal 0.1.414.** Spec 005 D3 and `plugins/claude-code/bin/squeal-launcher:170–213` implement #85's notice independently. Its scope is the first nonempty Claude Code, Codex, OpenCode or Pi session ID, else machine scope. It retains the last line per scope, at most 64 scopes, in `launcher-notices.json`; an unchanged line is suppressed, a changed line prints, and a failed marker write permits repetition. Current version notices for skewed plugins, older retained copies and a pinned Codex session behind the newest runtime all pass through that function. It writes stderr before importing the CLI. Direct CLI invocation bypasses it, as this probe did.

**inferred — Squeal 0.1.414.** #164 shares the noise concern of #85 and #131, but its reproduction needs no version mismatch or marker-write failure. Reusing the launcher's marker is a design proposal, not a proven fix for a CLI callable directly. #131's original emitter and failure remain undetermined because its report has no verbatim warning or runtime path. Its board hold asks for that evidence; this research does not remove it.

## Recommendation and open questions

**inferred — Squeal 0.1.414.** Approve only the bounded notice behavior and missing-effect explanation if the human wants this change. Preserve the uncertainty about delayed registration and the existing install command. The deciding tradeoff is repeated noise versus retaining actionable evidence when registration changes. The reproduction and unconditional source path prove the noise; the core lifecycle source requires conditional language about daemon exit. This research authorizes no implementation and changes no spec or hold.

The coordinator still needs to settle whether suppression follows session alone or session plus worktree, when a later loss of registration should speak again, and what happens when suppression state cannot be written. The original incident binary, live daemon state, exact installation path and effect on actual Pi delivery were not determined by this isolated probe.

## Verification of the deliverable

The probe exited 0, and the saved JSONL check confirmed nine completed calls and ten load checks below 24 CPUs. `git diff --cached --check` passed. Biome excludes the probe directory and processed no files. No product code changed and no suite ran.

The installed CLI's `status --wait 60000` over the four changed paths returned exit 3 after 60.5 s: no test closure held those paths; the daemon heartbeat was stale. It reported 0 known failures and 523 of 1490 test files unknown, not a passing affected-test verdict. The exact command is in the probe README. This does not change the completed isolated reproduction's result.

## Sources

- Fetched with `gh issue view <N> --repo hearsay-tools/squeal --json title,body,url,state` (164 also with `comments`, without `state`): [#164](https://github.com/hearsay-tools/squeal/issues/164), [#85](https://github.com/hearsay-tools/squeal/issues/85), [#131](https://github.com/hearsay-tools/squeal/issues/131). Issue reports are claims; section 1 independently reproduces only #164's notice.
- [Pi notice source at examined commit](https://github.com/hearsay-tools/squeal/blob/b509d603f483e5b869eb11b6cfecc744b057193e/src/cli/pi/status.ts); adjacent source paths and lines cited above.
- [Launcher source at examined commit](https://github.com/hearsay-tools/squeal/blob/b509d603f483e5b869eb11b6cfecc744b057193e/plugins/claude-code/bin/squeal-launcher).
- Local contract: [009 spec](../spec.md) D2/D7/D8 and [status](../status.md); [011 spec](../../011-core/spec.md) C8/C9; [005 spec](../../005-agent-adoption/spec.md) D3. Board `gh-131` records its evidence hold.
