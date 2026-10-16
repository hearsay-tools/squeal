# Issue 19: a read-only review told to run the slow tier

Reviewed 2026-10-17 at commit `63c2f9ab` (package version 0.1.203), installed Squeal 0.1.199. Source: [hearsay-tools/squeal#19](https://github.com/hearsay-tools/squeal/issues/19), labelled `friction`, filed 2026-10-16. Documentation triage only: no product code, spec, status, skill or board edit.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does Squeal 0.1.199 tell every session, edited or not, to run `run --slow --wait` before finishing? | Yes. The primer and skill step 4 say it whatever `stop.requireSlowSuite` says, and name no read-only or no-edit exception. | verified by experiment (text extraction from the installed 0.1.199 bundles) |
| 2 | Did the reporter's repository require the slow tier? | No. cezarion at `cf829732` sets `stop.requireSlowSuite: false`, so 0.1.199's wording was the only thing asking for the run. | verified by experiment (`git show` of the config) |
| 3 | Is the reporter's case already fixed on main? | For a repository with the policy off, yes. Since 0.1.202 (004-62, issue #5) the primer says "this repository does not require them before you finish", and step 4 asks for the run only when the `Slow tier:` line says `Stop waits`. | read in source code (0.1.203 source and committed bundle); not measured in a session |
| 4 | Does main exempt read-only or no-edit sessions when the policy is on? | No. The on-primer still says "before you say the task is done, run … unless … every slow file is current; Stop waits for them or holds you once". Neither the primer nor the skill mentions read-only work, and 004 D9's Stop wait applies "in every session". | read in source code (0.1.203) and docs (004 D7, D9) |
| 5 | Was the original incident (90 slow files queued, status at revision 0) reproduced live? | Not determined. Live reproduction was skipped because one-minute load was 24.73 on 24 CPUs. The counts are the reporter's. | not determined, because of the load hold |

## Findings

**1. 0.1.199's wording.** `extract.sh` printed the same sentence from both installed plugin bundles, `~/.claude/…/0.1.199/dist/session-start.mjs` and `~/.codex/…/0.1.199/dist/session-start.mjs`:

> Slow test files run when you pause between turns; before you say the task is done, run ${run} unless the latest `Slow tier:` line states every slow file is current: it runs the rest and waits for them.

Skill step 4 in both 0.1.199 copies: "Before you say the task is done, make the evidence current … while the last one says any slow file is not current, run `squeal run --slow --wait 60000`". Neither text has a condition on the policy or on whether the session edited anything. At revision 0 with 90 slow files not run, an agent that follows either text queues all 90. The issue reports exactly that. This is the defect issue #5 reported, now closed, seen this time from a no-edit review. Tag: verified by experiment.

**2. The reporter's policy.** `git -C ~/projects/cezar show cf82973…:squeal.config.json` prints `"requireSlowSuite": false` (`waitMs` 0, `requireFullSuite` false). Under 004 D9, Stop never waits for slow files with the policy off, so no hook forced the run. Only the injected text asked for it. Tag: verified by experiment.

**3. Main since 0.1.202.** `src/harness/shared/primer.ts`, `slowSentences`, off branch:

> Slow test files run when you pause between turns; this repository does not require them before you finish: say slow tests pass only when the latest `Slow tier:` line states every slow file is current, else say how many are not; ${run} runs them now.

Both branches are in the committed `plugins/claude-code/dist/session-start.mjs`. Skill step 4 now says "If the last one says `Stop waits`, they are required … Without `Stop waits`, say how many are not current." Under that text, a cezarion review that claims nothing about slow tests has no instruction to run them. 004 `status.md` (2026-10-16) records 004-62 as shipped in 0.1.202, with the review PASS at `52bd2d2a`. Tag: read in source code. Not measured: no session has read the new primer during a read-only review (006's `a2-slow` is pending the next atomic tier, per 004 `status.md`).

**4. What is still open on main.** Two gaps remain with the policy on:

- The on-primer and step 4 require the slow run from any session, including one that edited nothing and was told to run no tests.
- 004 D9's `stop-slow` entry waits up to `stop.slowWaitMs`, or holds once, for a main agent "in every session".

The issue's first two acceptance criteria are therefore met on main for policy-off repositories, by wording. They are unmet for policy-on repositories. Its third criterion, that implementation sessions still validate their edits, is what D9 and the on-primer already do. Tag: read in source code and in spec 004 D7, D8, D9.

**5. The vision filter.** Principles 1 and 3 and decision filter 1 favour not creating unrelated validation work. Against that, 004 D7 makes `requireSlowSuite` the project's explicit opt-in to hold an agent until its slow tier has run (principle 8, explicit boundaries). Whether a no-edit session is exempt from a project's opt-in is a policy choice. The evidence does not decide it. Tag: inferred from `docs/vision.md` and 004 D7.

## Recommendation for Squeal

- Record issue 19's reported case (policy off, 0.1.199) as fixed by 004-62 in 0.1.202, reproduced on 0.1.199 by text, not by a live session. Reporters on 0.1.199 should upgrade. The inspected installed plugin paths are version 0.1.199.
- The remaining question goes to the human through the coordinator: should a session with no edits since its registration (or one whose task forbids tests) be exempt when `stop.requireSlowSuite` is on? That touches 004 D7, D8 and D9 (Stop's wait) and 005 D6 (the primer's 1,500-character cap). No row is proposed here. The coordinator owns the board.
- Whatever is decided, the regression coverage the issue asks for is a primer or skill text test for a no-edit session under each policy value, plus a Stop test with zero consumer edits under the policy on.

## Limits and open questions

- Not reproduced live. At the gate check, one-minute load was 22.46, then 24.73 when the probe ran, on 24 CPUs (`/proc/loadavg`, `nproc`). The brief's hold applied: no daemon, fixture run, model session or suite. The reporter's 90/93 slow counts and the queued run are unverified.
- Whether the reporting session saw the primer, the skill or both is unverified. Both 0.1.199 texts give the instruction.
- 0.1.202's off-wording is verified only as text. Whether agents in read-only reviews stop running the slow tier is unmeasured.
- The "repository policy" the reporter cites (cezarion's review rules) was not read.

## Commands and sources

- `gh issue view 19 -R hearsay-tools/squeal --comments`, plus `--json title,body,createdAt,labels`.
- `cat /proc/loadavg; nproc`, `squeal --version` (0.1.199).
- `docs/specifications/005-agent-adoption/research/probes/issue-19/extract.sh "$PWD"`. Its output is in `probes/issue-19/output.txt`. It greps the installed `~/.claude/plugins/cache/hearsay/squeal/0.1.199` and `~/.codex/plugins/cache/hearsay/squeal/0.1.199` (`dist/session-start.mjs`, `skills/squeal/SKILL.md`), this checkout's `src/harness/shared/primer.ts`, `plugins/claude-code/dist/session-start.mjs` and `plugins/claude-code/skills/squeal/SKILL.md`, and `git show cf82973252a2ff702b4f5d18df7bd238cbcb9131:squeal.config.json` in `~/projects/cezar` (hearsay-tools/cezarion).
- Specs: `docs/vision.md`; 005 `spec.md` D4, D6; 004 `spec.md` D7, D8, D9 and `status.md` (2026-10-16, 004-62); `docs/board.md` row 004-62; [issue #5](https://github.com/hearsay-tools/squeal/issues/5) (closed).

## Duplicate check (coordinator)

`git show origin/main:docs/board.md` searched for `#19`, `gh-19`, read-only, primer, completion rule, and the named primer/skill surfaces. The reported policy-off wording overlaps completed 004-62 / closed #5; that repair is already on main. No row covers the remaining policy-on read-only exemption. `gh issue list --repo hearsay-tools/squeal --state open --limit 100 --json number,title,labels` found no open duplicate; #18 is triaged but concerns naming path-scoped waits, not exemption from slow completion. Issue #19 was not yet triaged. No product file paths were named in its body.
