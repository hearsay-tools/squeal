# 019-23 notes: Stop's words for configured groups

Worker 4ee52d30, 2026-11-04. Spec 019 D4's last paragraph, D6. Baseline 078b13416 (019-14, 019-15, 019-16 on 0.1.396).

## What changed

- **Texts** (`src/harness/shared/text.ts`). `stopGroupWords(group, command)` gives the words of one group Stop waits for. `slowSuiteReason`, `slowWaitReason` and `slowFailuresReason` take a trailing `group` (default `slow`). New `requiredSuiteReason`, `requiredWaitReason` and `requiredFailuresReason` give a line per group, joined by `\n`, in the order of the group's first file or failure. The callers (`stop-decide.ts`, `stop-slow.ts`) each make one call.
- **`StopRequired.groups`** (`src/core/state/required.ts`, additive): the names of the groups Stop waits for, in ownership order. The waiting entry's bound uses it when no file is open and only the runner part is pending.
- **Stop wait** (item 2). The group line already ended in "and Stop waits up to N min for them" (019-16, `readGroupTiers`). `stopSlowWaitMs` now reads the resolved default `slow` group's `stopRequires`, and `readGroupTiers` uses `stopWaitBoundMs`, so both read one bound. No text changes.
- **Nudge** (`nudgeSlow`, item 3): reads `lanePending ?? slowPending`. The scheduler's `nudge()` reaches every group lane (`group-tiers.ts`), so a group at `pause` or `stop` starts when the silent Stop ends the turn.
- **Skill** (`policy.md`, source only): the Stop section gives the holds per turn from the prompt and a group's command; the `stop.requireSlowSuite` and `stop.slowWaitMs` rows no longer say "once" or slow files only.

## Words chosen (the brief left them to this row)

- 2 s entry: ``Squeal policy checks puts the e2e group at stop and 1 e2e test file is not current at revision 1: test/e2e/slow.test.ts. `squeal run e2e --wait` runs them and waits for their results.``
- Bound: ``Squeal policy checks puts the e2e group at stop and after 0.3 s 1 e2e test file is still not current at revision 1: …. `squeal run e2e --wait` waits for their results.``
- Failure: `Squeal policy checks puts the e2e group at stop and the e2e group ran at revision 1: 1 check fails: ….`
- Runner part pending: `… the runner part of revision 1 is still pending: e2e test files it adds are not listed yet.`
- The default `slow` group: today's words, byte-identical (pinned by `stop-require-slow`, `stop-slow-wait`, `stop-slow-boundary`, `stop-holds`, `stop-required`, `codex/subagent-stop`, `pi/run`).
- The group name goes into the command unquoted, as 019-16's group line does.

## Decisions

1. **A line per group.** Two groups not current give two lines, each with its own policy and command. One group gives one line, so the slow-only text is unchanged.
2. **Runner part pending.** A group with an open file gets a line, with the runner-part sentence when the part is pending. With no open file, every group Stop waits for gets a line, since the part may add files to any of them. A group with no open file beside one that has open files gets no line.
3. **Item 2 is no new line.** A configured group at `stop` already had its line and its wait from 019-16. `slowPolicyView.stopWaitMs` stays `null` when only a configured group is at `stop`: the `Slow tier:` line must not say Stop waits for slow files it does not wait for.
4. **Item 3 keeps the nudge.** The waiting entry's `run-group` request does not cover every case: it asks nothing once `stop.maxHolds` holds are spent, nor when the waiting entry has not run for the session (Codex before `/hooks` trust). The nudge costs one socket call only when lane files are pending.

## Found, not fixed

- The `Slow tier:` line still says "Stop waits up to N for them or holds the agent once" (`slow-text.ts` `stopText`, not owned). With `stop.maxHolds` above 1 "once" is wrong for a main agent. Changing it changes a text without `checks` whose golden test pins it.
- `status --wait` (`src/cli/status-wait-lines.ts`, `slowTierText`, `pauseText`) speaks of slow files only: a quiet wait does not name a configured group's files not current, nor `squeal run <group> --wait`.
- Build drift, as in 019-14 and 019-16: `plugins/claude-code/dist`, the Codex runtime and the Pi package differ from the source (`plugin.test.ts > bundles`, `codex/packaging/runtime.test.ts`, `pi/package.test.ts`, the skill copies of `policy.md`). This row runs no build.
