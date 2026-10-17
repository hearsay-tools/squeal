# Issue 4 signals: which evidence ranks the slow files an edit likely affects

Researcher, 2026-10-17, Opus 5.5. Brief: `issue-4-signals-brief.md`. This builds on `issue-4-ranking.md`. No design. Squeal at `d8d9aa97` (0.1.211, with C15's promotion, 011-11). Cezarion was read only, through `git show`, `git ls-tree` and `git diff` at fixed revisions, and its live store was opened `readOnly`. Probes and logs are in `probes/issue-4-signals/`. Each probe ran with HOME, the XDG directories and npm's cache under `/tmp/i4s-home`, and `GIT_CONFIG_GLOBAL=/dev/null`.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Which signal ranks the wanted spec first? | **(b) tokens**, taken from the changed file plus the local modules it imports. In two shared-renderer edits and a CSS edit, they moved the wanted spec from 64th to 1st (E1), from 53rd/69th to 3rd/4th (E5), and the issue's 8 diff specs from 11th–48th to the top 10 (E6). They give no false lead on a build-script edit. (a), the stored closure, holds every source path for all 77 specs, so it ranks nothing. (c), a hint, works only where someone foresaw the edit. | verified by experiment (offline scorer over cezarion revisions), read in source code |
| 2 | Cost per edit, 77 specs? | (a) 0.01–0.02 ms. (b) 7–35 ms median with spec tokens cached, 40–70 ms cold over 6.8 MB of spec and helper text. It needs a token set per spec, and the changed file and its imports read at plan time. (c) one glob match per hint and nothing stored. | verified by experiment |
| 3 | Does C15 already cover the case? | Yes, when the agent knows the spec's path. A named wait on `artifact-project-links` ran it 1st of 77, in two runs. During a turn the agent also needs `squeal run --slow`. A source path never promotes. Ranking still matters when the agent does not know which spec is relevant, which was #1076's case, and in idle and end-of-session drains, where nothing is named. | verified by experiment, read in source code |
| 4 | Can a signal push a stale file out of the first slow tier, and does D5 still hold? | The slow tier has no duration-share bound. It takes the first `width` files in order, 1 file on cezarion and up to `slow.maxParallel` when idle. No signal drops a file: every pass ran all 77. The risk is delay, not exclusion. A file with no evidence moves back by the number of files that have evidence (14 in E5). A stale hint or a missed token puts the relevant file no later than today's place plus that count. | read in source code, verified by experiment |

## Findings

### 1. Closure coverage on six edits

**Method (verified by experiment).** `signals.mjs` ranks the slow web specs present at each edit's revision. "Today" means the runner's `direct` class first (the spec imports the path in one hop), then shortest CI duration (`../issue-4-ranking/ci-durations.json`), unknown last, then path. That is C4 step 4 when recency ties, and on cezarion it always ties (`issue-4-ranking.md` 2). Each signal ranks specs that have evidence first, by score, and keeps today's order among the rest, as the issue's criterion 2 asks.

The signals:
- **(a)** the edited path is in the stored closure of the spec, from cezarion's store, read 2026-10-17.
- **(a′)** the edited path is in the spec's own relative-import closure, without the declared inputs.
- **(b1)** tokens from the diff hunks alone.
- **(b2)** tokens from the whole changed file plus its local imports. This is cezarion's manual method from AGENTS.md (#1096, `f1fb182e0`).
- **(c)** a hint a maintainer would write from that AGENTS.md text and the issue's comment: `markdown.tsx` and `components/diff/**`, nothing else.

The tokens are `data-*` values, `aria-label`s and hyphenated non-utility class names. On the spec side they are matched whole against the spec plus its `./` helpers (`issue-4-ranking.md` 5). Tokens that more than 20 specs match are dropped.

"Wanted" is the spec that broke (E1), the spec importing or named for the file (E2), the callers of the changed function (E3), the specs the author extended in the same commit (E5), or the issue comment's set (E6). Positions are 1-based. N is the number of specs at that revision.

| Edit (N) | Wanted | Today | (a) | (a′) | (b1) | (b2) | (c) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| E1 `markdown.tsx`, `979d96c91` #1076 (76) | `artifact-project-links` | 64 (739 s of CI time before it) | 64 | 64 | 64 (0 tokens) | **1** (2 tokens, 1 spec) | 5 (6 hinted) |
| E2 `thread-scroll.ts`, synthetic at `d88c8c1d3` (77) | `progressive-history`, `thread-scroll` | 1, 70 | 1, 70 | 1, 70 | n/a | 1, 70 (0 tokens) | 1, 70 |
| E3 helper `github-fixture.ts`, `c04150895` #1044 (75) | `github-core`, `github-layout` | **2, 7** (7 one-hop importers lead) | 2, 7 | 2, 7 | 2, 7 (0) | 2, 7 (`gh-tabs`, the same 7) | 2, 7 |
| E4 config `build-e2e.sh`, `a805cb41f` #1097 (77) | none (all equal) | today | today | today | no evidence | no evidence | no evidence |
| E5 `accessibility.css`, `7077c7a7a` #966 (73) | `good-css`, `task-thread` | 53, 69 (458 s) | 53, 69 | 53, 69 | **1, 2** (2 tokens, 2 specs) | 3, 4 (10 tokens, 14 specs) | 53, 69 |
| E6 `components/diff/diff.tsx`, synthetic at `d88c8c1d3` (77) | the comment's 8 | 11–48 | 11–48 | 11–48 | n/a | **1–5, 7, 8, 10** (11 specs) | 1–8 |

- **(a) never discriminates (verified by experiment, store read only).** All 87 stored web-spec closures (`method` "static imports plus declared inputs") hold the edited path in every edit above (`logs/store-closures.txt`). The declared inputs `packages/web/src/**` and `packages/web/e2e/**` are expanded into the same list as the imports, and `test_files.closure_paths` is one column, so the store cannot tell which paths came from imports.
- **(a′) adds nothing beyond today.** The only specs that import a changed path are the one-hop importers that today's `direct` class already leads with (E2, E3). The scheduler probe confirmed this for slow files: after a helper edit, its 7 importers ran 1st to 7th of 77 in both runs. Two-hop sources such as `src/lib/github-nav-contract.ts`, reached through `github-fixture.ts`, are the only gap, and no recent edit hit one.
- **(b1) depends on what the diff touched.** #1076's 50 changed lines in `markdown.tsx` carry no token (E1), so the real incident is missed. A CSS rule edit carries exactly the right ones (E5).
- **(b2) found the incident's spec.** The match is `link-safety-dialog` and `link-safety-url` from the imported `link-safety-dialog.tsx`. `link`, from `data-streamdown="link"`, is dropped because 30 specs match it. The extractor missed `thread-markdown` in a `className={cond ? '…' : '…'}`. With it, five more specs would score 1, still below this spec's 2 (inferred). On E5 the whole stylesheet brings 12 unrelated specs ahead, which is noise compared with (b1).
- **(c) is exact where written and blind elsewhere.** E1's hint lists 6 specs with equal weight, so the wanted spec runs 5th. E2 to E5 have no hint.
- **Every signal misses `thread-scroll.e2e.ts` in E2.** It shares a name with the source file, not a token.

### 2. Cost (verified by experiment)

`cost.mjs` reads cezarion's working tree at `82f97570c` from disk, as a daemon would. It ran 50 iterations at load 10.2 on 24 CPUs, Node 24.21.0 (`logs/cost.txt`).

| Signal | Plan-time cost, 77 specs | Needs stored | Needs at plan time |
| --- | --- | --- | --- |
| (a) stored closure | 0.01–0.02 ms (membership) | nothing new, and useless here (finding 1) | the revision's paths |
| (a′) import closure | free for one hop (`affected.ts` already computes `direct`). Deeper hops need the import part kept apart from declared inputs, which today's `closure_paths` does not do. | a separate import list per file | the runner graph |
| (b2) tokens | median 6.8 ms (`markdown.tsx`), 32.9 ms (`diff.tsx`), 35.0 ms (`accessibility.css`) with spec tokens cached. Cold, reading 6.8 MB each time: 40 to 70 ms median, p90 at most 89 ms. | a token set per spec, keyed by its own and its helpers' hashes | the changed file and its local imports, read once |
| (b1) diff tokens | as (b2) | the previous content of every changed file. The store keeps only `file_hashes`, so this would come from git `HEAD` or a content cache. | the diff |
| (c) hint | one glob test per hint | nothing (policy) | nothing |

Warm cost grows with the number of tokens: E6 has 24, E1 has 4. These are probe numbers, not a product implementation. The probe compiles one regex per token and scans the whole text.

### 3. Interaction with C15 (verified by experiment, read in source code)

- **Experiment.** `probe.test.ts` pass 3 edits `markdown.tsx`, then calls `scheduler.promote([artifact-project-links], 600 s)` as a named wait would. The spec ran 1st of 77 in both runs, against 4th with no durations and 64th to 66th with durations. The probe has no consumer, so the idle trigger ran the tier.
- **What the agent has to know.**
  1. The spec's own path. A source path is not promoted (C15, `ownPathFiles` in `src/cli/status-wait-promote.ts`). Because of finding 1, a source path also selects all 77 specs.
  2. During a turn, `squeal run --slow` as well. `#trigger` in `slow-tier.ts` lets a slow file run only when the consumer is idle, on a `run --slow` request or under a `run --all` checkpoint. C15 says promotion does not make the slow tier eligible.
- **What the agent is told.** The named line tells it at wait time ("slow, run when the agent pauses or on `squeal run --slow`", 011-12). The skill (`plugins/claude-code/skills/squeal/SKILL.md` step 3, `references/commands.md`) never says that naming a file runs it sooner.
- **Covered and not covered.** The issue comments from #1135 and #1132 named `task-thread` and `screenshot-element`. Those are the knows-the-spec case, which 0.1.199 could not promote and C15 now covers. This was not replayed through the CLI against a live daemon. #1076 is not covered: nobody knew the spec, and CI found it. Ranking also orders the idle tier and the `codex exec`/`-p` end-of-session drain, where nothing is named. Cezarion's AGENTS.md grep followed by a named wait reproduces (b2) by hand, at the cost of the agent knowing to do it.

### 4. Safety (read in source code, verified by experiment)

- **No duration bound in the slow tier.** `joinSpan` (001-184) applies to fast tiers only (`tiers.ts`). The slow tier takes `orderedSlow()`'s first files up to `width`: the slot's permits when fast work is idle, else 1. `slowWidth` and the capacity grant cut it further (`slow-tier.ts` ~372–391). On cezarion the first slow tier is one file, so a signal puts its top file first and every other file in a later tier.
- **Nothing is dropped.** Each signal only sorts the same queue, and every probe pass ran all 77 files. D5's "every stale file still runs" holds as long as ranking stays a sort key, not a filter.
- **Delay is the real risk, and the slow lane has no fairness turn.** `RECENT_TIERS_PER_BACKLOG_TIER` counts fast entries only (`queue.ts`). Each web edit re-queues all 77 through the declared inputs, so under steady edits the tail runs only when edits pause. That is already true today for the longest files: `github-layout`, 95 s, runs last.
- **How late each signal can push a relevant file.** With a signal, the tail is the files without evidence. A relevant file the signal misses moves back by the number of files that have evidence: 0 for (a), 1 to 14 for (b2) in finding 1, and the hint's size for (c).
  - (b) misses a spec that selects by text or role rather than by token (E2's `thread-scroll`).
  - (c) misses whatever its author did not foresee, and goes stale silently when specs move.
  - (b1) on a refactor with no token in its hunks behaves like no signal.
  - None of them can put a file later than today's position plus that count.

## Recommendation for Squeal

The evidence favours **(b2)**: tokens from the changed file and its local imports, matched against each slow spec and its local helpers, dropping tokens most specs share. It would be a tie-breaker inside today's class, after C15's promoted files and `direct`. It is the only signal that found #1076's spec (64th to 1st), and it ranked E5's and E6's wanted specs into the top 10. It gave no false lead on a build-script edit and agreed with `direct` on a helper edit, for 7 to 35 ms an edit with a cached spec side.

Its limits weigh against vision filter 4 and goal "start simple":
- It is a DOM and browser-test heuristic: `data-*` attributes and class names.
- Its precision drops on large shared files: 14 specs with evidence for a stylesheet.

(c) is the generic, policy-governed complement (filter 5), exact where written and blind elsewhere. (a) should be dropped for cezarion's shape. A separate import list would only help two-hop helpers. Since C15 already serves an agent that knows the spec, the design question is whether the remaining case (an unknown spec, plus idle and end-of-session drains) is worth a stack-specific heuristic, or only a hint key. That is the coordinator's and the human's call.

## Open questions

1. Does (b2) hold beyond cezarion? Not determined: only one repository's browser suite was scored, on six edits, with one person's choice of "wanted".
2. Does a named wait through the real CLI and daemon on 0.1.211 lead the slow lane as the scheduler API did? Not determined: the probe called `scheduler.promote` directly, with no consumer in a turn.
3. Should the skill tell agents that naming a slow spec, together with `squeal run --slow`, runs it first? This is a 005 guidance question, not tested.
4. The extractor misses ternary `className`s and template strings (finding 1). A product version would need the extraction rules set in the design.

## Sources

- hearsay-tools/squeal#4 and its seven comments (`gh issue view 4 --comments`, 2026-10-17). `issue-4-ranking.md` and `probes/issue-4-ranking/` (`ci-durations.json`).
- Squeal `d8d9aa97`:
  - `src/core/scheduler/queue.ts` (`priorityOf`, `orderedSlow`, `RECENT_TIERS_PER_BACKLOG_TIER`), `tiers.ts` (`joinSpan`), `slow-tier.ts` (`#candidates`, `#trigger`, width), `scheduler.ts` (`promote`)
  - `src/runners/vitest/affected.ts`, `src/core/store/schema.ts` (`test_files.closure_paths`, `file_hashes`)
  - `src/cli/status-wait-promote.ts`
  - spec 011 C4 step 4 and C15, spec 004 D2, D5 and D8, `docs/vision.md` (decision filter, impact-aware scheduling)
  - `plugins/claude-code/skills/squeal/SKILL.md` and `references/commands.md`
- hearsay-tools/cezarion:
  - commits `979d96c91` (#1076), `c04150895` (#1044), `a805cb41f` (#1097), `7077c7a7a` (#966) and `f1fb182e0` (#1096, the AGENTS.md method)
  - `d88c8c1d3` and the working tree at `82f97570c`, `squeal.config.json`
  - store `~/projects/cezar/.git/squeal/store.sqlite`, opened `readOnly`
- Probe `probes/issue-4-signals/`: `signals.mjs`, `tokens.mjs`, `cost.mjs`, `store-closures.mjs`, `probe.test.ts` (Node 24.21.0, Vitest 5.0.3; runs at 17:27 and 17:29 local time, 92 s and 88 s, load 22.5 and 9.0 on 24 CPUs), `logs/`.
