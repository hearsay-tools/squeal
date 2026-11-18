# The start message against a minimal form: an experiment

Rows 005-126 and 005-127. Question (the human, 2026-11-18): does an agent need the long start message, or do a short description and pointers to the CLI do? Brief, forms and the staged run plan with its degradation rule, written before any run: `../tasks/wave-30.md`. Experiment branch `exp/minimal-primer`; the Squeal under test is commit `86fd6c9ce` in every stage (0.1.562 plus `squeal checks`, a check's `description`, and the form switch). Nothing of it is on main.

Form A is the shipped start message. Form B (`primer-minimal`): what Squeal does, and pointers to `squeal checks`, `squeal status`, `squeal run <check>`, `squeal retry <file>` and `squeal --help`. In both forms the hook messages after the start and the skill are unchanged.

Every count below is sessions that met a measure over sessions where it was computable. Models and scenarios are never pooled. A gap that is small or not significant is unresolved, not equivalence.

## Stage 1: Sol, 10 repetitions, three scenarios

Run 20261118T131437Z-3045e6, 60 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T131437Z-3045e6.primer-minimal.atomic-variant.json`; regraded under the rules after design check r3: unchanged. Host: 24 CPUs, 4 sessions at once, load about 5 to 12 at the starts read.

| Scenario | Measure | A | B |
|---|---|---|---|
| `a12-manual-check` | `claim-true` (says `fail`) | 10/10 | 10/10 |
| `a12-manual-check` | `no-false-pass` | 10/10 | 10/10 |
| `a3-harmless` | `claim-true` | 10/10 | 10/10 |
| `a3-harmless` | `current-before-claim` | 10/10 | 10/10 |
| `a3-harmless` | `no-rerun-answered` | 10/10 | 10/10 |
| `a4-pending` | `no-claim-on-pending` | 9/9 | 4/4 |
| `a4-pending` | `no-sleep` | 9/9 | 4/4 |

**By the plan's rule: no degradation on Sol.** No scored measure differs; no false pass in either form; no hand run in either form (`own-run` 0/10 and 0/10 in every scenario).

Context, no direction (*measured*):
- Sol loaded the skill in 10 of 10 sessions in both forms, in every scenario. The skill holds the behaviour rules the short form drops, so for Sol the rules arrive either way.
- `squeal checks` and `squeal --help` were used in 0 of 10 sessions in both forms, in every scenario.
- `a12-manual-check`: every session ran the on-request check through Squeal (10/10 and 10/10). In form A no session looked the check up first (0/10): the start message names it. In form B 9 of 10 did (a `squeal status` that showed the check waiting; p = 0.00012). So the short form costs one more command there, and the agent still found the check without `squeal checks`.
- `a12-manual-check` median session time 31 s (A) and 38 s (B); `a3-harmless` 108 s and 100 s; `a4-pending` 42 s and 42 s.
- `a4-pending`: checks were still pending when the second turn was sent in 9 of 10 sessions of form A and 4 of 10 of form B, so its measures were computable less often in B (two-sided Fisher p = 0.057 on 9/10 against 4/10; *derived*). The cause is not determined; the scenario sends the second turn at once and the pending state depends on timing.

What 10 against 10 cannot show: a true 90% against 60% is detected in about 15% of such runs (`../reviews/exp-minimal-primer-design.md`, section 6). Stage 1 rules out a collapse on Sol, not a moderate loss.

## Stage 2: Sonnet, 10 repetitions, three scenarios

Run 20261118T133910Z-5b7445, 60 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T133910Z-5b7445.primer-minimal.atomic-variant.json`, run with the harness after design check r3's fixes. Host load about 5 at the start.

| Scenario | Measure | A | B |
|---|---|---|---|
| `a12-manual-check` | `claim-true` (says `fail`) | 10/10 | 10/10 |
| `a12-manual-check` | `no-false-pass` | 10/10 | 10/10 |
| `a3-harmless` | `claim-true` | 4/4 | 5/5 |
| `a3-harmless` | `current-before-claim` | 4/4 | 5/5 |
| `a3-harmless` | `no-rerun-answered` | 10/10 | 10/10 |
| `a4-pending` | `no-claim-on-pending` | not computable (0 of 10 pending) | 10/10 |
| `a4-pending` | `no-sleep` | not computable | 10/10 |

**By the plan's rule: no degradation on Sonnet.** No scored measure is lower in B; no false pass; no hand run in either form (`own-run` 0/10 everywhere).

Context, no direction (*measured*):
- **The short form made Sonnet load the skill.** `a12-manual-check`: skill loaded in 0 of 10 sessions with A and 10 of 10 with B (p = 0.000011). `a3-harmless`: 0/10 and 2/10. `a4-pending`: 0/10 and 0/10. Sonnet's long-run record with the shipped message is 0 of 12.
- `squeal checks` was used once (1 of 10, `a3-harmless`, B) and never elsewhere; `squeal --help` never.
- `a12-manual-check`: every session in both forms ran the on-request check through Squeal after a `squeal status` that showed it waiting (10/10 and 10/10).
- `a3-harmless`: no `TESTS:` claim in 6 of 10 sessions (A) and 5 of 10 (B), in both forms about half, so the claim measures are computable on few sessions. Median session time 83 s (A) and 50 s (B); Squeal waits per session 3 (A) and 1 to 2 (B).
- `a4-pending`: checks were pending when the second turn was sent in 0 of 10 sessions of A and 10 of 10 of B. With the long message Sonnet waited for the verdict before it ended its editing turn; with the short one it ended the turn and waited when asked for the result. Both forms made one Squeal wait per session. In B the claim never came while checks were pending (10/10). Sol went the other way in stage 1 (9 of 10 pending with A, 4 of 10 with B). *The reading of where the wait fell is derived from the pending flag and the wait counts, not from reading each session.*

## Reading after stages 1 and 2, and the next stage

In the three scenarios chosen to decide, neither model shows any loss with the short form at 10 against 10, and neither runs tests by hand in either form. Two things the long message was thought to carry arrive another way: Sol reads the skill in every session, and Sonnet reads the skill when the start message is short.

A gap in the plan, seen while reading these results (stated here because it changes the order after results were known): the three scenarios test hand runs, early claims and the on-request check. They do not test three other things the short form drops: the sentence on slow tests, the sentence on when to ask for a retry, and the list of what Squeal does not cover ("run those yourself"). The scenarios that do are among the nine not run: `a2-slow`, `a8-load-hold` (slow tests), `a9-env-retry`, `a10-retry-real`, `a11-inherited-flake` (retry), `a5-uncovered`, `a6-daemon-down` (the agent's own run is the right behaviour) and `a1-break`, `a7-stale`.

So the next stage is those nine scenarios at 10 repetitions, Sol first (180 sessions), then Sonnet, in place of 30 more repetitions of `a12-manual-check`, which is at 10 of 10 in both forms and both models. The human allowed it ("We can always run the other scenarios if needed"). The degradation rule is unchanged and applies per scenario; in `a5-uncovered` and `a6-daemon-down` a hand run is right, so there the hand-run context does not count against a form. More repetitions of the three deciding scenarios stay available as later stages.

## Stage 3: Sol, 10 repetitions, the nine other scenarios

Run 20261118T135832Z-efb36f, 180 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T135832Z-efb36f.primer-minimal.atomic-variant.json`. Host load about 5 to 13.

Every scored measure is 10 of 10 in both forms in eight of the nine scenarios: `a1-break` (claim, no false pass, no rerun), `a2-slow` (the same), `a5-uncovered` (claim, own run covers), `a6-daemon-down` (claim, no false pass, own run covers), `a7-stale` (claim, current before claim), `a8-load-hold` (claim, no false pass, slow through Squeal), `a10-retry-real` (claim, no false pass, no retry past a failure), `a11-inherited-flake` (claim, no false pass, retry for environment, claim after retry). `a9-env-retry`: claim 10/10 and 10/10, no false pass 10/10 and 10/10; `retry-for-environment` and `claim-after-retry` 0 of 3 (A) and 3 of 4 (B), computable in few sessions (p = 0.14).

**By the plan's rule: no degradation on Sol in any of the nine.** With stage 1, Sol shows no loss with the short form in all 12 scenarios at 10 against 10.

Context (*measured*): the skill was loaded in 90 of 90 sessions in each form. `squeal checks` was used in 3 of 90 sessions of B (0 of A); `squeal --help` in 2 of 90 of A (0 of B). A hand run happened only in `a6-daemon-down` (10/10 and 10/10), where it is the right behaviour. Median session times differ by scenario in both directions (for example `a1-break` 101 s and 85 s, `a7-stale` 25 s and 39 s).

## Stage 4: Sonnet, 10 repetitions, the nine other scenarios

Run 20261118T150319Z-6cea1b, 180 sessions, 0 failed, coverage complete (*measured*). Results file `evals/results/2026-11-18-0.1.562.20261118T150319Z-6cea1b.primer-minimal.atomic-variant.json`. Host load about 8 to 13 at the start.

Seven scenarios show no difference in any scored measure: `a1-break`, `a2-slow`, `a6-daemon-down`, `a7-stale`, `a8-load-hold`, `a10-retry-real` all 10 of 10 in both forms; `a5-uncovered` claim 10/10 and 10/10, `own-run-covers` 4/10 and 3/10. No false pass in any scenario of either form.

The two scenarios with a failure that the agent did not cause differ:

| Scenario | Measure | A | B | p |
|---|---|---|---|---|
| `a11-inherited-flake` | hand run of the tests (context `own-run`) | 0/10 | 6/10 | 0.011 |
| `a11-inherited-flake` | hand run while Squeal's results were pending | 0/10 | 5/10 | 0.033 |
| `a11-inherited-flake` | `claim-true` (truth: pass) | 0/9 | 5/10 | 0.033 |
| `a11-inherited-flake` | `retry-for-environment` | 1/10 | 2/10 | 1.0 |
| `a11-inherited-flake` | `claim-after-retry` | 9/9 | 7/10 | 0.21 |
| `a9-env-retry` | hand run of the tests | 0/10 | 4/10 | 0.087 |
| `a9-env-retry` | `claim-true` (truth: pass) | 10/10 | 6/9 | 0.087 |
| `a9-env-retry` | `retry-for-environment` | 3/10 | 5/10 | 0.65 |
| `a9-env-retry` | `claim-after-retry` | 10/10 | 7/9 | 0.21 |

**By the plan's rule: a degradation on Sonnet in `a11-inherited-flake`.** With the short form Sonnet ran the whole suite by hand (`npx vitest run`, `npm test`; read in the timelines of the sessions) in 6 of 10 sessions, against 0 of 10 with the shipped message; `a9-env-retry` shows the same direction, 4 of 10 against 0 of 10, below the rule's threshold. A hand run of the suite is the behaviour the shipped message's sentences forbid ("do not run Vitest ... to learn whether your edits broke something"; "Run tests yourself only when ..."; "For a failure from load or a stopped service: `squeal retry` ..."). Form B stops here; no further repetitions of B are run.

What the degradation is and is not (*measured unless marked*):
- It is a change of behaviour, not of safety: no false pass in either form.
- In `a11-inherited-flake` the hand run made Sonnet's claim right more often (5 of 10 against 0 of 9): the scenario's failure is a flaky test stored before the session, the truth is "pass", and with the shipped message Sonnet reported it as `fail` in 9 of 9 claims without asking for a retry (1 of 10 asked). So the shipped message is wrong here in another way: it keeps Sonnet off a hand run and does not get it to `squeal retry`.
- In `a9-env-retry` the hand runs came with worse claims (6 of 9 right against 10 of 10: two `unknown`, one `fail`, one session with no claim).
- The hand runs fall where Sonnet did not load the skill: `a9-env-retry` skill loaded 0/10, `a11-inherited-flake` 2/10. Where it loaded the skill with the short form (`a10-retry-real` 10/10, `a7-stale` 8/10, `a2-slow` 5/10, `a8-load-hold` 3/10; with the shipped message 0/10 everywhere) there was no hand run. *The link between the two is an observation over scenarios, not a tested cause.*
- Outside these two scenarios the short form cost nothing in score and often took less time (median session: `a1-break` 89 s and 31 s, `a8-load-hold` 85 s and 25 s, `a10-retry-real` 26 s and 12 s; `a7-stale` 24 s and 32 s).
- `squeal checks` was used in 3 of 90 sessions of B, `squeal --help` in none.

## Reading after four stages (480 sessions)

| | Sol, 12 scenarios | Sonnet, 12 scenarios |
|---|---|---|
| Scored measures lower with the short form | none | none at p < 0.05; `a9-env-retry` claim 10/10 against 6/9 (p = 0.087) |
| False pass | none in either form | none in either form |
| Hand runs where they are wrong | none in either form | `a11-inherited-flake` 0/10 against 6/10; `a9-env-retry` 0/10 against 4/10 |
| Skill loaded | 120/120 in both forms | 0/120 with the shipped message; 40/120 with the short form |
| `squeal checks` used | 3 of 120 with the short form | 4 of 120 with the short form |

1. For Sol the start message's rules are redundant with the skill, which it always reads. The short form behaves the same in every scenario.
2. For Sonnet the short form holds in ten of twelve scenarios and brings back hand runs of the suite in the two where a failure exists that the agent did not cause. That is the one place where the short form drops something Sonnet needs before it knows to look for it.
3. The pointer to `squeal checks` was almost never followed (7 of 240 sessions). Agents found the on-request check through `squeal status`. A description in the config would reach the agent only if `squeal status` or a hook message carried it.
4. The shipped message has its own fault in `a11-inherited-flake` on Sonnet (0 of 9 right claims), which this experiment did not set out to measure.

Each cell is 10 against 10; a true 30-point loss is detected in about 15% of such comparisons, so "no difference" in a scenario is unresolved, not equivalence.

Not run: form C (the short form with two behaviour rules); more repetitions of any scenario.

## Per session: which sessions ran the tests by hand

The human asked (2026-11-18) whether a session that loaded the skill did everything right. Counted per session over the 480 sessions of the four stages (*measured*; "wrong hand run" is a hand run outside `a5-uncovered` and `a6-daemon-down`, where it is right):

| Model, form | Read the skill | Sessions | Wrong hand runs | Right claims |
|---|---|---|---|---|
| Sol, shipped | yes | 120 | 0 | 120 of 120 |
| Sol, short | yes | 120 | 0 | 120 of 120 |
| Sonnet, shipped | no | 120 | 0 | 104 of 113 |
| Sonnet, short | yes | 40 | 0 | 36 of 38 |
| Sonnet, short | no | 80 | 10 | 70 of 76 |

- No session that had read the rules ran the tests by hand: 0 of 400. The rules reached it through the skill (280 sessions) or through the shipped start message (120). All 10 wrong hand runs are in the 80 sessions that had read neither.
- Loading the skill did not make every claim right. In `a11-inherited-flake` the two Sonnet sessions that loaded it both reported the flaky failure as `fail`, as the shipped message's sessions did (0 of 9 right). The skill's main file does not mention `squeal retry` at all (0 occurrences in `plugins/claude-code/skills/squeal/SKILL.md`; 4 in `references/commands.md`): the retry rule is only in the shipped start message and in the failure message's last line.
- The split is not an experiment: Sonnet chose whether to load the skill, and it chose by scenario (short form: `a12-manual-check` and `a10-retry-real` 10 of 10, `a7-stale` 8, `a2-slow` 5, `a8-load-hold` 3, `a3-harmless` and `a11-inherited-flake` 2, the other five 0). So "the skill prevents hand runs" is an association here, not a tested cause. *What makes Sonnet load it in one scenario and not in another is not determined.*

Constraints on where the rules can live (*read in source*):
- The start message is capped at 1,500 characters (`PRIMER_CAP_CHARS`, `src/harness/shared/primer.ts`) because Codex cuts a hook's text and keeps a trailing start message whole only up to that length (`src/harness/codex/output.ts`). The skill's main file is about 5,250 characters, with about 105,000 more in its reference files.
- The skill ships for Claude Code, Codex and Pi. OpenCode has no skill: its sessions get the start message in the system prompt (cap 8,000 characters there) and nothing else.
- Form B is 391 characters, form C 540; the shipped message was 1,449 in the repository that raised the question.

## Forms E and F: sending the agent to the skill

The human, 2026-11-18, after the per-session count: "maybe we should figure out how to make sure it loads the skill?" Two forms, each the short form B plus one lever, and in both the retry rule added to the skill's main file as a new step 3 ("A failure you did not cause ...: do not run the tests yourself ... `squeal retry <file> --reason load` or `--reason environment` ... claim from that result"), which the shipped skill lacks:

- **E** (`primer-minimal-skill`): the start message ends "Read the squeal skill before you run or judge tests." The skill's description is the shipped one.
- **F** (`primer-minimal-desc`): the start message is form B unchanged; the skill's description becomes "Use before you run tests yourself, and when a test fails or a SQUEAL message reports a failure, in a repository that uses Squeal (...). Squeal already runs the tests in the background; this says what to do instead of a hand run, how to retry a failure you did not cause, and how to read its reports."

Both are variant files only (`evals/variants/`); the Squeal under test is still `86fd6c9ce`, so the shipped arm is the same build as in stages 1 to 4. Sonnet only, the two scenarios where form B failed, 10 repetitions: 40 sessions per form, 0 failed, coverage complete (*measured*). Runs 20261118T173659Z-b4230e (E) and 20261118T175441Z-03ae58 (F); results files `evals/results/2026-11-18-0.1.562.20261118T173659Z-b4230e.primer-minimal-skill.atomic-variant.json` and `...20261118T175441Z-03ae58.primer-minimal-desc.atomic-variant.json`. Host load about 9 to 12.

Each form against the shipped arm of its own run, and form B's numbers from stage 4:

| Scenario | Measure | Shipped (E's run) | E | Shipped (F's run) | F | B (stage 4) |
|---|---|---|---|---|---|---|
| both | skill loaded | 0/20 | 20/20 | 0/20 | 20/20 | 2/20 |
| both | hand run of the suite | 0/20 | 0/20 | 0/20 | 0/20 | 10/20 |
| both | false pass | 0 | 0 | 0 | 0 | 0 |
| `a11-inherited-flake` | `retry-for-environment` | 2/10 | 10/10 | 7/10 | 8/10 | 2/10 |
| `a11-inherited-flake` | `claim-true` | 1/9 | 8/8 | 7/10 | 5/7 | 5/10 |
| `a9-env-retry` | `retry-for-environment` | 1/10 | 7/10 | 4/10 | 2/10 | 5/10 |
| `a9-env-retry` | `claim-true` | 8/9 | 9/9 | 4/9 | 10/10 | 6/9 |

1. **Both levers made Sonnet load the skill in every session** (20 of 20 each; p = 0.000011 per scenario against the shipped arm). The sentence in the start message and the new description each do it alone.
2. **With the skill loaded, the hand runs are gone**: 0 of 40, against 10 of 20 for form B.
3. **Claims are at least as good as with the shipped message, and better where a run can show it.** E: `a11-inherited-flake` right claims 8 of 8 against 1 of 9 (p = 0.0004), retries 10 of 10 against 2 of 10 (p = 0.0007); `a9-env-retry` retries 7 of 10 against 1 of 10 (p = 0.02). F: `a9-env-retry` right claims 10 of 10 against 4 of 9 (p = 0.011); `a11-inherited-flake` no difference (5 of 7 against 7 of 10).
4. **The shipped arm varies much between runs of the same build.** `a11-inherited-flake` right claims: 0 of 9 (stage 4), 1 of 9 (E's run), 7 of 10 (F's run); retries 1, 2 and 7 of 10. `a9-env-retry` right claims: 10 of 10, 8 of 9, 4 of 9. So one run of 10 against 10 in these two scenarios is weak evidence in either direction, and a form is compared only with the shipped arm of its own run. *The cause of the variation is not determined (the scenarios' failures depend on load and on a service; the three runs were hours apart).* Summed over the three runs (*derived*; same build, same arm): shipped `a11-inherited-flake` right claims 8 of 28 and retries 10 of 30; E and F together 13 of 15 and 18 of 20.
5. Sessions took longer where the agent now waits for a retry: `a11-inherited-flake` median 117 s (E) and 118 s (F) against 87 s and 88 s.
6. Which part does the work is not separated: E and F each change two things against B (the lever, and the retry rule in the skill). The retry rule cannot act unless the skill is loaded, and loading alone did not give right claims in stage 4 (the two sessions of B that loaded the shipped skill claimed `fail`).

Not tested: forms E and F in the other ten scenarios and on Sol; both levers together; forms C and D (rules in the start message without the skill).
