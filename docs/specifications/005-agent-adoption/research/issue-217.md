# Issue 217: finding the existing reach command

Improve task-oriented discovery of `squeal reach` in help and the skill.

The reproduction is partial: guidance omits an entry point, but the command already exists and answers the question. This is evidence for a text change, not a new analysis engine or proof that a text change will alter agent behaviour. Existing holds stand. No implementation is authorized by this report.

## Scope and method

Examined on 2026-11-14, within the 20-minute bound. The installed CLI reports **0.1.475**, on Node **v26.13.0**. Its release commit is `95350e5e916f45540b251545a34351bfb2f4c6d1` (`squeal--v0.1.475`). The research checkout is `e9cf07c6b94f59232075f0cba578a74df64d63ae`, package version **0.1.480**. Live commands use the installed 0.1.475 launcher, not the checkout's build.

Initial commands `cat /proc/loadavg`, `getconf _NPROCESSORS_ONLN` and `nproc` gave one-minute load **9.71**, **24 CPUs** and **24** available CPUs at 11:03:42 UTC. Load was checked again before each captured CLI command. Both reach calls started below 24: **8.13** and **8.75**. Reproduction was therefore allowed. Only documented read-only CLI commands ran. No test, warm-up, checkpoint, nested agent session, store decoding or direct `store.sqlite` query ran. No configuration or product file changed.

The brief has no numbered questionnaire. The following questions cover its requested checks. Raw commands, outputs, exit codes and durations are in the linked transcripts.

| Question | Answer and evidence tag | Version |
| --- | --- | --- |
| 1. Does help expose reach? | Yes in full help and `reach --help`; the reported keyword filter removes its whole entry. **verified by experiment** | 0.1.475 |
| 2. Do the primer and top-level skills name it? | Neither top-level skill names it. This session's primer does not. The shared primer source has no reach guidance. **read in official docs** for skills; **read in source code** for primer | 0.1.475 |
| 3. Is it documented elsewhere in the skill? | Yes, `references/commands.md` has a full `squeal reach` section. The skill's reference description names only status, why and run. **read in official docs** | 0.1.475 |
| 4. Does reach already answer test-selection questions? | Yes: the ranked view shows counts, seconds, path kinds, gateway chains and suggestions; a named environment file shows its setup route and test files. **verified by experiment** | 0.1.475 |
| 5. Is the reported agent detour and count error reproduced? | Not determined, because no incident transcript or historical state was examined and nested sessions were excluded. The issue is reporter evidence only. **inferred** limitation | Report names 0.1.475 |
| 6. What constraints govern guidance changes? | 005 D6 treats the primer as the main surface. 015 D11 explicitly keeps reach pull-only and says registration, delivery and status do not name it. A primer addition needs that policy reconciled. **read in official docs** | Specs at checkout `e9cf07c6` |

## Findings

**1. The filter misses existing help.** Full `squeal --help` includes:

```text
squeal reach [<path>...] [--limit <n>] [--json]
  What one edit of each file re-runs, from the stores,
  with no daemon and no test run: files and test files
```

Its remaining lines name coverage, path kinds, a gateway and a suggestion. None contains `graph|closure|import|select|dep`. Running the issue's equivalent filter, `squeal --help | rg -i 'graph|closure|import|select|dep'`, therefore yields no reach entry. It does return status and run selection lines and `squeal import`. This reproduces the lexical discovery failure, not an absence from help. **verified by experiment, 0.1.475**.

**2–3. Guidance exists one level deeper.** Whole-word searches find zero `reach` lines in installed `skills/squeal/SKILL.md` and `skills/setup/SKILL.md`. The commands reference has `## squeal reach` at line 176. It explains ranked and named views, coverage gaps, environment paths, exit codes and the no-run contract. However, the top-level reference bullet describes it as “what `squeal status`, `squeal why` and `squeal run` print” and suggests reading it for wait output or red/green checks. Its description does not direct a test-selection question there. **read in official docs, 0.1.475**.

The installed setup skill, commands reference and CLI bundle are byte-equal to their tagged Claude Code copies. The Squeal skill differs only by the added Codex launcher paragraph. The tagged shared primer source contains no `reach` word or command. The actual Codex primer delivered to this session also omits it. A new Claude Code SessionStart was not invoked. **read in source code, 0.1.475**.

**4. The existing command provides the requested analysis.** With the launcher path below substituted for `squeal`:

| Exact argument list | Result | Load / CPUs |
| --- | --- | --- |
| `reach --limit 3` | Exit 0, 6.262 s. Header: 1,795 test files, 7,552 recorded seconds. First entry `src/core/store/prune-rules.ts`: 1,250 test files, 6,733 s, 89% of suite seconds; test-helper route, full example chain and split-helper suggestion. | 8.13 / 24 |
| `reach test/global-teardown.ts --limit 2` | Exit 0, 5.977 s. Named path: 1,795 test files, 7,552 s, 100%; `setup` route, test-file examples and “keep its imports leaf-only” suggestion. | 8.75 / 24 |

Both outputs report **917 files without a current coverage record**, accounting for **72% of suite seconds**. Their suggestions to obtain missing evidence were not executed. These outputs show a supported answer with uncertainty, not an independent audit of every count. The default ranking uses avoidable seconds, then seconds re-run; it is not a ranking by test-file count. Percentages refer to recorded seconds. **verified by experiment, 0.1.475**.

015 D11 defines reach as trusted test closures **plus project environment files**, including setup, global setup and config closure. The named probe confirms that environment evidence appears as `setup`; it does not independently compare internal closure rows. **read in official docs, checkout `e9cf07c6`; verified by experiment, 0.1.475**.

**5. Keep historical claims separate.** Issue 217 reports Claude Code / `claude-opus-5-5`, about 25 minutes and 30 tool calls, and an intermediate count of 1,204 instead of 1,469 for a cezar setup-chain module. Its sample names 1,816 suite files and 99 manual-group files excluded. Those are historical reporter counts, not this reproduction's results. Neither the agent's choices nor those numbers were verified. **inferred limitation from the fetched issue, reported 0.1.475**.

## Recommendation and open questions

Favor task-oriented help and skill discovery for the existing command. The deciding tradeoff is discoverability versus extra unconditional session text: help already carries the capability, and 015 D11 deliberately forbids pushing it in registration or delivery. A primer change is a policy decision for the coordinator and human, not an automatic fix under 005 D6. **inferred from the verified guidance gap and the two specs**.

Open: whether changed wording makes agents choose reach first; whether the historical cezar counts are correct; and whether primer placement should change 015 D11. No behavioural claim follows from a keyword search. This bounded research does not resolve these questions.

## Sources and reproducible evidence

- [Issue 217](https://github.com/hearsay-tools/squeal/issues/217), fetched with `gh issue view 217 --repo hearsay-tools/squeal --json number,title,body,comments,url,createdAt,updatedAt`; no comments at fetch time.
- [CLI transcript](../../../../research/probes/issue-217/cli.txt), [named-path transcript](../../../../research/probes/issue-217/named.txt), [guidance and issue snapshot](../../../../research/probes/issue-217/guidance.txt), [probe instructions](../../../../research/probes/issue-217/README.md).
- Installed launcher: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`. Installed texts: `/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.475/skills/`.
- [Shared primer at the examined release](https://github.com/hearsay-tools/squeal/blob/95350e5e916f45540b251545a34351bfb2f4c6d1/src/harness/shared/primer.ts), read with `git show squeal--v0.1.475:src/harness/shared/primer.ts`.
- [005 D6](../spec.md#d6-texts), [005 amendment log](../status.md), [015 D11](../../015-coverage-complexity/spec.md#d11-edit-reach-which-files-make-an-edit-re-run-much-of-the-suite-approved-by-the-human-2026-11-07-name-squeal-reach-coverage-off-option-a-rows-015-108-015-109-015-114-015-115), [015 amendment log](../../015-coverage-complexity/status.md), at checkout `e9cf07c6`.
