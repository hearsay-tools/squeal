# Issue 5 triage: optional slow-suite policy and the completion guidance

Brief: `tasks/issue-5.md`. Issue: https://github.com/hearsay-tools/squeal/issues/5 (read 2026-10-16 with `gh issue view 5 --json`, open, no comments). Examined at `052b1307` (Squeal 0.1.200, Node 24.21.0). Triage only. No product file, board, spec or status was changed.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the generated guidance change with `stop.requireSlowSuite`? | No. The primer is byte-identical for `false` and `true`, and both tell the agent to run `run --slow --wait 60000` before saying the task is done. | verified by experiment |
| 2 | Which surfaces read the policy? | Stop (the 2 s entry and the waiting entry) and the `Slow tier:` line do. The primer, the skill's step 4, `commands.md` and the quiet line of `status --wait` don't. | verified by experiment (primer, line, Stop bound); read in source code (the rest) |
| 3 | Is it Codex-only? | No. The same `slowSentences` feeds the Claude Code, Codex, Pi and OpenCode primers, and the same step 4 is in all three skills. Codex differs only in how it names the CLI. | verified by experiment (Claude Code, Codex); read in source code (Pi, OpenCode) |
| 4 | Does an open row cover it? | No. 001-283 introduced the instruction (done). 001-285, 001-317 and 001-323 made Stop and the line policy-aware (done). 001-284 was dropped. 004-61 is about lanes (done). The board has no planned, running or held row for it. | read in source code (`docs/board.md`) |
| 5 | What is new, and what stays unverified? | New: the reproduction, that it covers every harness, and that spec 004 D8 was never amended for 001-283's sentence. Unverified: the reporter's 91-queued / 89-pending-after-60 s incident. | verified by experiment / inferred |
| 6 | How does it compare with the vision? | It conflicts with "Squeal reports whether the policy is met. It does not quietly redefine 'done'". It also conflicts with the reporter's repository, whose `AGENTS.md` says to follow the skill and also reserves full-suite runs for CI. | read in official docs (`docs/vision.md`, cezarion `AGENTS.md`) |

## Findings

### 1. Reproduction (verified by experiment, `052b1307`)

`research/probes/issue-5/probe.ts` (throwaway) writes a temp `squeal.config.json` with `slow.include: ["test/e2e/**"]` and `stop.requireSlowSuite` set to `false`, then `true`. It loads that file with `readPolicy`, builds the coverage that `coverageOf` builds for 91 listed slow files, and prints the primer under `squeal` and under the Codex CLI path, the Stop bound (`stopSlowWaitMs`) and the header's `Slow tier:` line. It reads no store, starts no daemon and queues no test file.

    npm ci
    npx tsx docs/specifications/004-slow-suites/research/probes/issue-5/probe.ts

The full output is in `probes/issue-5/output.txt`. `cmp` of the two Codex primers: identical. Under both values the policy was read correctly (`policy read: false` / `true`), and every primer contains:

> Slow test files run when you pause between turns; before you say the task is done, run `node --disable-warning=ExperimentalWarning "/plugins/squeal/dist/cli/squeal.mjs" run --slow --wait 60000` unless the latest `Slow tier:` line states every slow file is current: it runs the rest and waits for them.

The surfaces that do read the policy change as specified:

- off: `stopSlowWaitMs: null`, and the line ends "Squeal runs the pending ones when the agent pauses and has not queued the rest; `squeal run --slow` runs them now."
- on: `stopSlowWaitMs: 120000`, and the line ends "Stop waits up to 2 min for them or holds the agent once; …".

The cause, read in source: `primer(command, coverage)` and `slowSentences(command, naming)` (`src/harness/shared/primer.ts:58`, `:174`) take no policy. `Coverage.slow` is `{ files }` only (`src/harness/shared/coverage.ts:35`). `coverageOf` reads the whole policy but passes nothing about `stop` on. The test pins the sentence with no policy in scope (`test/harness/primer-coverage.test.ts:186`), so nothing tests the policy-on and policy-off guidance against each other. The committed bundles of all four plugins carry the sentence (`grep -l` over `plugins/*/dist`).

### 2. The other surfaces (read in source code, `052b1307`)

| Surface | Reads the policy | What it says |
|---|---|---|
| Primer slow sentence (`primer.ts:180`) | no | imperative: run `run --slow --wait` before done |
| Skill step 4 (`plugins/{claude-code,codex,pi}/skills/squeal/SKILL.md`) | no | "Before you say the task is done, make the evidence current … Done when … the `Slow tier:` line says every slow file is current". It has a fallback: say what stays pending. |
| `references/commands.md`, `run --slow` | no | "It is the skill's step 4 before saying the task is done." |
| `references/policy.md`, `stop.requireSlowSuite` | yes (it describes the key) | correct |
| `references/reports.md`, Slow tier | yes | "whether Stop waits for them is policy" |
| Quiet `status --wait` line (`src/cli/status-wait-lines.ts:118`) | no | factual: "N slow files are not current, which this wait does not hold for: `… run --slow --wait 60000` runs and waits for them". It gives a pointer, not a requirement. |
| `Slow tier:` line (`src/core/state/slow-text.ts:138`) | yes | see 1 |
| Stop, 2 s entry (`src/harness/shared/stop.ts:129`, `:226`) and the waiting entry (`src/core/slow/stop-wait.ts:50`) | yes | off: never blocks or waits on slow files (004 D9) |

So the primer and the skill tell the agent to do on its own what Stop, by policy, doesn't hold it for. The quiet line and the status line read as a consistent report. The imperative is the source of the conflict.

### 3. How it got here (read in source code)

- 001-283 (0.1.128, the human's row, done-when "the primer names `run --slow --wait` as the slow step before a claim") added the sentence and step 4. Its reasoning (`001-core-loop/research/primer-skill-writing.md` F1) was that the primer said when slow files run but never what to do before a claim. F1 also says this change "is not expected to move the metric alone". The `stop-slow` variant moved it, and 001-285 carries that variant behind the setting.
- The same day, the human amended 004 D9: "with it off, Stop never waits for slow files, as before" (001 `status.md`, 2026-10-12). D9 still ends "`stop.requireSlowSuite` (D7) is the opt-in for a project that wants an agent held until its slow tier has run."
- `primer-skill-writing.md` lists the spec drift as the coordinator's to amend: "Spec 004 D8's primer sentence says when slow suites run … the primer now names `run --slow --wait`". D8 today still says only that the primer "says when slow suites run (when the agent pauses or on `squeal run --slow`) and when a slow failure arrives". No amendment for the before-done step was found in 004 `spec.md` or `status.md`. The primer has gone past the spec it implements, and nobody recorded a decision that the step holds whatever the policy is.
- 001-317 / 001-323 (with 006-52) made the off branch of the status line say what Squeal does. The human kept the default off.

### 4. Duplicate-row assessment (read in source code, `docs/board.md` at `052b1307`)

| Row | Status | Covers issue 5? |
|---|---|---|
| 001-283 primer and skill rewrite | done, 0.1.128 | Introduced the instruction. It is the change the issue would amend, not a cover for it. |
| 001-284 one-shot detection | dropped | No. The human chose policy over session kind. |
| 001-285 Stop waits when the setting is on | done, 0.1.128 | No. Stop is correct (finding 1). |
| 001-317, 001-323 off-line wording | done, 0.1.145 / 0.1.147 | No. The line is policy-aware and accurate. |
| 004-61 lane flags | done, 0.1.196 | No. It keeps explicit `run --slow`, which the issue asks to preserve. |
| 005-15 texts | done, 0.1.146 | No. It is still relevant to ownership: since the 2026-10-12 split, wording aimed at agent behaviour is 005's, and the facts the texts state are 001's. |

No planned, running or held row names the primer, the skill and the slow policy together. Issue 5 is new work. Issues 3 and 4 (build preconditions, slow ordering) are separate, as the reporter says. Neither is triaged here.

### 5. The reporter's incident (not reproduced; inferred where noted)

The brief forbade queuing a real slow suite or running a paid session, so the runtime claim (a `run --slow --wait 60000` in a cezarion session with no product change queued 91 slow files, then 89 were still pending after 60 s) is **not verified**. What can be checked without running it:

- The repository is the local `/home/agent/projects/cezar` (`origin` hearsay-tools/cezarion, `82f97570c`, 2026-10-16). Its `squeal.config.json` sets `stop.requireSlowSuite: false` and `baseline.onStart: "lookup-only"`. Its slow tier is `test:package` (`slow: true`, 13 files there) plus `packages/web/e2e/*.e2e.ts` (77 files), with `slow.maxWorkers 1` and `maxParallel 1`. That makes 90 files at this checkout, consistent with the reported 91 (read in source code, files listed, nothing run). At one file at a time, 89 pending after 60 s is plausible (inferred).
- Its `AGENTS.md:180-212` says to follow Squeal's installed skill, and then: "The final gate and full-suite runs belong in CI. Do not run the entire local gate, `squeal run --all`, or the full Vitest or browser suite just to finish a task". It names `run --all`, not `run --slow`. Its intent covers the slow tier, which is both E2E suites (read in official docs of that repository).
- Not determined: why all 91 were not current in that session. A fresh worktree under `lookup-only` that inherits nothing for those keys (004 D6) would explain it. Reading the store would settle it, and the brief does not reach that far.

### 6. Vision (read in official docs, `docs/vision.md` at `052b1307`)

- Line 168: "the harness or agent reads that status and checks it against the project's completion policy. 'Known failures: 0' plus 'full suite not run on this revision' is a real answer, and a different one from 'done'."
- Line 184: "Let projects define what validation is required … before task completion … Squeal reports whether the policy is met. It does not quietly redefine 'done'."
- Line 137: anything expensive "needs explicit policy".

With the policy off, the primer turns the slow tier into a completion requirement that the project did not set. The vision favours the issue. The eval design pulls the other way. The judge's `current-before-claim` (`evals/lib/rubric.mjs:42`) asks for "nothing pending, stale or unknown, the slow tier included" before a `pass` claim, and 006's `a2-slow` measures `slow-through-squeal` under the default (off) policy (`evals/lib/atomic-measures.mjs:30`). Both treat a pass claim that covers the slow tier as needing it current. They say nothing about finishing without that claim.

## Recommendation for Squeal

Surface the decision to the human before anyone writes a row. The code is a one-seam change. What needs deciding is what "done" requires with the policy off, and 001-283's done-when, which the human approved, says the opposite of the D9 opt-in. The options:

1. **Policy-conditional, as the issue asks.** With the setting off, the primer and step 4 say how to read the `Slow tier:` line and report it: don't claim slow tests pass unless it says current, and `run --slow --wait` gets that result. With it on, keep today's step. Cost: 006 re-pins `current-before-claim` and `slow-through-squeal` by policy, and the default-policy arm's "right behaviour" changes. Under the memory rule on per-situation expectations, that rule change belongs to the 006 coordinator.
2. **Keep it unconditional and amend 004 D8 and D9 to say so.** The claim discipline stays as 001-283 measured it. Issue 5 closes as intended, and repositories like cezarion live with a skill that conflicts with their `AGENTS.md`.
3. **Claim-scoped.** Leave the policy as the thing that holds the agent, and make the guidance conditional on the claim: run the slow step only before a claim that covers the slow tier, otherwise state its state. This is narrower than 1 and keeps the eval rubric's pass-claim rule as it is.

Whichever is chosen, a row would own `primer.ts` (`slowSentences` takes the policy through `Coverage`), the three `SKILL.md` step 4s, `commands.md`'s `run --slow` sentence, and primer tests for both policy values, with the wording owned by 005 and the facts by 001. The quiet wait line and the status line need no change.

## Open questions

1. Is 001-283's unconditional step a decision the human holds, or drift from D9? No record either way. Only the human can answer.
2. Under option 1 or 3, does the false-claim rate on `a2-slow` move? Not determined. It needs a variant run, which is 006's spend.
3. Why the reporter's 91 slow files were all not current in a docs-only session (finding 5). Not determined, because it would need that session's store.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/5
- Probe: `research/probes/issue-5/probe.ts`, `README.md`, `output.txt` (revision line at its top)
- `src/harness/shared/primer.ts`, `src/harness/shared/coverage.ts`, `src/core/state/slow-text.ts`, `src/cli/status-wait-lines.ts`, `src/harness/shared/stop.ts`, `src/core/slow/stop-wait.ts`, `test/harness/primer-coverage.test.ts`
- `plugins/{claude-code,codex,pi}/skills/squeal/SKILL.md`, `plugins/codex/skills/squeal/references/{commands,policy,reports}.md`
- `docs/specifications/004-slow-suites/spec.md` D7 to D9, `status.md`; `docs/specifications/001-core-loop/status.md` (2026-10-12), `research/primer-skill-writing.md` F1 and its spec-drift list, `research/slow-claims.md`
- `docs/board.md` rows 001-283, 001-284, 001-285, 001-317, 001-323, 004-61, 005-15, 006-52
- `docs/vision.md` lines 137, 168, 184; `evals/lib/rubric.mjs:42`, `evals/lib/atomic-measures.mjs:30`
- cezarion: `/home/agent/projects/cezar` at `82f97570c`, `squeal.config.json`, `AGENTS.md:180-212`
