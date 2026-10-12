# Research: the primer and the skill, read by writing-for-agents

Board row 001-283. The reference is Matt Pocock's `writing-for-agents` (`mattpocock/skills` at 32165827, MIT), `SKILL.md` and `SKILL-MECHANICS.md`, read as text with `gh api`; nothing from that repository was installed or run. The documents read: the primer (`src/harness/shared/primer.ts`), the skill and its references in both plugins, spec 001 D9 and 004 D8, `research/slow-claims.md`, and the four variant results in `status.md` (2026-10-12).

Lever names are the reference's: context pointer, context load, information hierarchy, progressive disclosure, co-location, sprawl, completion criterion (clarity, demand), premature completion, leading word, negation, single source of truth, cache, relevance, sediment, no-op.

## What sits where

| Document | Load | Holds |
|---|---|---|
| Primer | Always (context load), every session that registers, both harnesses | The steps every branch needs: keep working, when to wait, the slow step before a claim, when to run tests yourself, what is covered and what is not. |
| Skill description | Always, as a context pointer; Claude Code lists it behind the Skill tool, Codex as a file path | The trigger branches and what the material is. |
| `SKILL.md` | Disclosed, loaded when the description fires (Codex sol always, luna a third; Claude never, 0 of 120) | The five steps with completion criteria, the header's file list. |
| `references/*.md` | Disclosed behind pointers in `SKILL.md` | Every count, line and command output; red/green; policy. |

The measured fact that decides the split: Claude Code sessions never load the skill, whatever its description says (`skill-desc` 0 of 12), and loading it moved no claims (`skill-file`). Only the primer reaches every session. So the primer carries every must-have step, and the skill is the deeper layer for the agents that load it.

## Findings

### F1. The slow step had no place before the claim (completion criterion; premature completion). Changed.

The primer said when slow files run and never what to do about them before saying the task is done; the skill's step 3 was done on `Returned on quiet`, which a quiet wait gives while the slow tier runs (`slow-claims.md` §2), and step 4 allowed a claim with checks pending if named. The bound was clear but did not cover the slow tier, so a model following it to the letter completed early.

- Primer: a slow sentence beside the wait it extends: "before you say the task is done, run `squeal run --slow --wait 60000` unless the header's `Slow tier:` line already says every slow file is current: it runs the rest and waits for their results." `run --slow --wait` holds for the slow files since 001-282.
- Skill step 4, "make the evidence current": the same command, and a criterion the agent checks against lines it can read: no check of its edits pending, the `Slow tier:` line saying every slow file is current, every claim matching a line of `squeal status` (demand: every claim, every slow file). The pending fallback stays, after a second wait.
- Step 3 says it does not wait for slow files and points at step 4.

The `slow-step` variant (the primer naming `run --all --wait`) moved current-before-claim only within chance, and `stop-slow` is what moved it (8 of 9 for Haiku); 001-285 carries that. This change makes the documents true and complete; it is not expected to move the metric alone.

### F2. "never during Stop's wait" goes stale and is a negation (relevance; negation). Changed.

With `stop.requireSlowSuite` on, Stop now waits for the slow tier (001-285). The primer, `SKILL.md` and `reports.md` all said slow files run "never during Stop's wait". Removed from the primer and the skill; `reports.md` now says whether Stop waits for them is policy and points at `policy.md` (`stop.requireSlowSuite`), which 001-285 owns, rather than describing the wait. Left for others: the header's slow-tier line itself still ends "Not covered by Stop's wait" (`src/core/state/slow-text.ts`, not this row's file), which is false with the setting on once 001-285 lands.

### F3. The primer said twice that results arrive after tool calls (duplication; context load). Changed.

Sentence one said results "arrive as SQUEAL messages after your tool calls", sentence two "Results arrive with your next tool call, so keep working". Now said once, in the first sentence, with "so keep working"; the second sentence starts at "Wait only when". The next-tool-call default still comes before every `status --wait` (the human's rule, 001-88). The Vitest-only primer went from 626 to 588 characters, while the slow primer grew from 991 to 1,032 for the new step; the cap of 1,500 holds with any CLI path (the tests' 4,095-character path).

### F4. The prohibition "do not run Vitest" (negation). Left.

It is the one prohibition the human decided (001-88), a hard guardrail (agents ran the suite themselves in 005's pilot and Haiku in 9 of 9 misses), and it already follows its positive target (results arrive with your next tool call, so keep working), as the reference asks of a guardrail it keeps.

### F5. The description restated coverage, wrongly for some repositories (context pointer: cut identity; single source of truth). Changed.

"Squeal already runs the Vitest tests, and the node:test tests where squeal.config.json lists nodeTest projects" is identity the body carries and a static copy of what the primer computes from the config; in a node:test-only repository it named Vitest as run, the defect review wave 13aa B1 fixed in the primer. It now says Squeal "already runs the suites its primer lists as covered", a pointer to the one source. The trigger is unchanged: "about to run tests (vitest, npm test) or to check whether a change broke something", which the human decided (wave 10, 001-88) against "before claiming done". The task-wide `skill-desc` wording, the reference's "sharpen the pointer first", was tried and left Claude at 0 of 12, so the must-have material moved into the primer instead, the reference's fallback ("inline the material only if sharpening fails"). The parenthesis "(vitest, npm test)" is kept as the shared words an agent's own intent uses, not synonyms of another branch.

### F6. Coverage said four times in the skill (duplication; co-location). Changed.

The description, the intro, step 1's title and step 5 each restated what is covered. Now the intro says it once, as the primer's list, naming the three kinds (Vitest, `nodeTest` projects, `slow` files) for an agent that loaded the skill without a primer in view, and step 5 refers to "the suites the primer does not list".

### F7. Red/green in `SKILL.md` (progressive disclosure by branch; sprawl). Changed.

The reference's branching test: inline what every branch needs, disclose what only some reach. Red/green is reached only when a task asks to show a test catches a bug. It moved, unchanged, to `commands.md` beside the wait it uses, and the pointer names it ("red/green ... Read it ... before a red/green check"), red/green being the leading word for that branch. `SKILL.md` went from 5,427 to 4,183 characters, the steps first and nothing between them and the pointers but the header's file list (spec 001 D9 requires that sentence).

### F8. The slow-tier paragraph in `SKILL.md` (duplication; co-location). Changed.

Its states duplicated `reports.md`'s slow-tier bullet, its arrival sentence duplicated `reports.md`'s "When reports arrive" and the primer. Removed; what the agent does with the line sits in step 4, the line's states in `reports.md`, behind a pointer that now names "the slow tier's states".

### F9. `commands.md` repeated the claim rules (duplication). Changed.

The `squeal status` bullets restated step 4 (say what is pending, "no known failures yet") and the `run --slow` paragraph restated the claim step. Each is now one sentence pointing at step 4. The wait's wall paragraph is split into what it holds for, its four first lines and the details; "Quiet says no result your edits owe is outstanding, not that they passed" joins the quiet line, where a reader of the wait meets it.

### F10. Exposition in the references (no-op; sediment). Changed where it changed nothing.

- `commands.md`: "It first asks the daemon to record any edit you just made, so it never returns quiet at the revision before it" is a guarantee with no action for the agent. Removed. "A daemon from before this rule" reads as "a daemon from an older release".
- `reports.md`: the "touches files" bullet listed every internal reason the line can be absent (daemon start order, a store's first session, registration expiry). The agent does the same in every case. Collapsed to the reason it is absent and the one reading: it may or may not be your edit; read the failure on its own.

### F11. Leading words. Kept and used consistently.

"current" is the header's own word and the claim step's criterion ("make the evidence current", "every slow file is current"); "done" is the claim moment in the primer and the skill ("before you say the task is done"); "red/green" names the disclosed branch. No coined words.

### F12. The busy-host figure (cache). Left.

"at load 100 to 170 on 24 CPUs, ... up to 51 s" is the reason behind `--wait 120000`, which no config or `--help` confesses: the kind of cache the reference keeps. It stays in `commands.md` only; the step keeps the bare number.

### F13. The rest of `reports.md` and `policy.md`. Left.

`reports.md` is a flat peer-set of header terms consulted on demand, which the reference calls fine. `policy.md` belongs to 001-285 in this wave.

## Not done, and for whom

- `src/core/state/slow-text.ts`: "Not covered by Stop's wait" in the header's slow-tier line (F2), false with `stop.requireSlowSuite` on after 001-285.
- `evals/variants/slow-step.json` and `skill-file.json` patch the primer's old text in `dist`; their `find` strings no longer match once `dist` is rebuilt. They were one-time experiments; `skill-desc.json`'s `find` is the whole old description, which F5 changed, so it no longer applies either.
- Spec 001 D9's skill paragraph lists the steps as they were; step 4 now names the slow tier, and red/green is in `commands.md`. Spec 004 D8's primer sentence says when slow suites run "when the agent pauses or on `squeal run --slow`"; the primer now names `run --slow --wait`. Both specs are the coordinator's to amend.
