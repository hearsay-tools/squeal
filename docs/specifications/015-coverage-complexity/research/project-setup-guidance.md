# Project setup guidance for agents

Recommend a short project-checks reference reached from the existing setup skill. A second skill has no demonstrated benefit yet.

2026-10-27, row 015-90. Research only. Examined Squeal **0.1.359**, commit `d4fb461149952329b8bb1c62f69d0dd6f2c7896b`, Node **24.21.0**. Tags below apply at that version. No product, skill, repository policy, spec or board changed. The disposable projects declare Vitest 5.0.3; no runner was installed or executed there.

| Question | Answer and evidence |
| --- | --- |
| 1. Extend setup or add a skill? | **Inferred:** extend setup and repair its existing reference gaps. Setup already owns discovery, questions, application and diffs. A separate skill repeats those steps or needs a handoff back to setup. See comparison below. |
| 2. What can be found, and what needs a decision? | **Verified by experiment:** plans identify Vitest and estimate one test file in each layout, but expose no helper classification or effective coverage settings. Both plans and setup checks accept the configurations before exclusions. **Inferred:** directory purpose and acceptable measurement gaps require project evidence and owner policy. |
| 3. What is the smallest useful workflow? | **Inferred:** inventory, classify paths, explain effective checks and limits, propose a diff, then verify authorized changes. The [draft](probes/project-setup-guidance/draft.md) was used for the static walkthrough. It adds no default or gate. |
| 4. What may an agent change? | **Read in source code:** setup asks per choice; it has no coverage-exclusion flag. **Inferred:** an agent can prepare a precise proposal without approval. Applying it needs authorization covering the changed paths and settings; existing authorization suffices. Keep unresolved paths included. |
| 5. Can one agent follow it safely, and at what cost? | **Verified by experiment:** this researcher completed two static walkthroughs with explicit diffs; neither newly excluded product code or claimed a test pass. **Not determined:** live daemon results, independent agent compliance and actual session token cost. No nested model session ran. |

## Existing guidance and the gap

**Read in source code.** The two setup skills are byte-identical. They run the JSON plan and non-terminal questions, ask about harnesses, instruction blocks, gates, slow groups, build-output exclusions, trust and warm-up, then apply and show changes. They also warn about duplicate instructions and the plan's `not run` / `run twice` findings. The operational skills teach affected waits, failures, slow-tier completion and unknown results. Their policy reference defines coverage exclusions, complexity and CRAP; their commands reference describes `squeal code`. Repeating this material in another skill would create another maintenance point. [S1–S3]

**Read in official docs.** Round 2 C5 records 46 of 109 noise lines from helpers added before their tests, plus 64 unclear lines with longer gaps. Its proposed default based on test globs was not adopted. The later human decision keeps explicit exclusions and rejects automatic directory inference and a new-file delay. [S4]

**Read in source code.** Setup has no step that connects those policy keys to a project's helpers, fixtures or measurement limits. Its question and answer types have no coverage, complexity or lint choices. `--exclude` means a runner's test exclusion, **not** `coverage.exclude`. The reference says coverage comes from Vitest; current source and spec also support node:test. Neither setup nor the operational policy reference documents the implemented `lint` keys. These are existing-documentation gaps, not evidence that a new skill is needed. [S1–S3, S5]

| Option | Benefit | Cost or limitation | Judgment |
| --- | --- | --- | --- |
| Extend setup with a short reference | Reuses the existing entry point, discovery and approval flow; covers initial setup and later changes | Must distinguish command-owned choices from a separately proposed coverage diff; keep the main skill short | **Inferred:** smallest scope |
| Separate project guidance skill | Could support a distinct recurring configuration audit | Adds discovery, invocation and handoff rules; still needs setup and operational references | **Inferred:** consider only if later sessions show a separate recurring need |

## Facts, choices and draft workflow

**Read in source code.** The plan reads tracked manifests and config text. It can report runner detection, node:test declarations/seeds and omitted scripts, pytest projects/overlaps, slow/build-output evidence, config problems and instruction/gate state. A store-backed listing is stronger evidence than `config-text` or `default`. With no stored listing, Vitest patterns are extracted from literal arrays; the plan does not execute dynamic configs. Its detected runner is not proof that the runner can load. Its config facts report problems and selected missing keys, not the effective code-check policy. Read that policy separately. [S2]

**Inferred.** Read the paths and their uses before proposing exclusions. In these authored fixtures, tests import the helpers and fixtures; `src/helpers/public.ts` is a deliberate product control. In an unfamiliar repository, naming and imports are evidence to show the owner, not proof that a directory is test-only. Mixed-use files remain included unless the owner accepts losing their coverage checks. A confirmed separate test tree may justify `test/**`; these probes use narrower helper and fixture paths. Never widen a colocated test glob to `src/**`.

**Read in source code and official docs.** Explain these facts when they affect a choice. [S3–S5]

- Complexity and coverage default **on** in 0.1.359. The brief's “coverage opt-in” must be version-aware: enabling a project that set it off is a choice; changing the product default is outside this research. Coverage needs complexity. Thresholds are 20 for complexity and 30 for CRAP; neither implies a blocking gate.
- `coverage.exclude` retains complexity but removes CRAP and `untested` checks. Runner exclusions remove tests from Squeal's runs. `complexity.exclude` removes counts, and an explicit list replaces its defaults. Preserve each existing list and explain the different effects.
- Vitest and node:test supply coverage records under supported isolation. Pytest supplies none. Test-created child processes and user worker threads are outside measured execution. Runtime input observation can see a child read without measuring its function coverage. Inspector use, shared isolation, provider failures and missing records need explicit qualification. `untested` is not proof that no test exists; `unknown` is not a failure or a pass.
- CRAP combines complexity and measured lines. It is evidence for investigation, not a target for assertion-free tests. If lint is configured, inspect the project's ESLint setup and Squeal's lint policy. Lint defaults off and is independent of complexity. An `eslint` script alone does not prove Squeal lint is enabled or available.
- Switching coverage on re-keys covered results once. Prior research reports median +12% CPU per edit here, about 28 KiB per result, and +18% CPU per node:test file in its sample. These are local historical measurements, not forecasts for another project. Warm-up runs all tests and is a separate resource choice. [S4, D8/D10]

**Inferred.** The five-step [draft](probes/project-setup-guidance/draft.md) keeps choices reviewable: read the plan and project policy; classify exact paths; explain relevant defaults and limits; present the full proposed config and any separate instruction diff; apply only within authorization and verify. Ask about unresolved purpose, omitted suites, accepted measurement limits, resource budget and gates only when the project has not already answered. Do not make a broad exclusion to silence an unexplained failure. An ordinary setup request does not approve a new gate, threshold or removal of an existing exclusion.

## Scratch results and proposed configuration

**Verified by experiment.** Ran:

```text
node --import tsx docs/specifications/015-coverage-complexity/research/probes/project-setup-guidance/probe.mts
{"layouts":2,"assertions":"passed","elapsedMs":2430,"load":[44.62,42.63,39.17],"cpus":24,"calls":15}
```

The [probe and results](probes/project-setup-guidance/README.md) preserve fixture contents, plans, question output, match tables and diffs. Each plan and both before/after checks exited 0. Non-terminal `setup` exited 1 with questions, as expected. Hashes including the scratch `.git` contents stayed unchanged across these read-only calls. Both plans estimated one test without a current result. No question mentioned helper exclusions, coverage or lint. This is the smallest observed gap: successful setup checking does not establish suitable coverage boundaries.

| Layout | Test pattern | Proposed additions to `coverage.exclude` | Observed controls |
| --- | --- | --- | --- |
| Separate | `test/**/*.test.ts` | `test/helpers/**`, `test/fixtures/**` | Literal test pattern misses helper and fixture; both explicit globs match them |
| Colocated | `src/**/*.test.ts` | `src/test-support/**` | Literal test pattern misses helper and fixture; widening to `src/**` also matches both product controls |

**Verified by experiment.** Both proposals preserve the pre-existing `src/generated/**` exclusion. Neither newly excludes `src/math.ts` or `src/helpers/public.ts`. No runner or complexity exclusion changed. For the colocated fixture, the complete resulting config is:

```json
{
  "coverage": { "exclude": ["src/generated/**", "src/test-support/**"] },
  "complexity": { "blocking": false },
  "lint": { "enabled": false }
}
```

This is a fixture-specific proposal, not a template to copy blindly. The [colocated diff](probes/project-setup-guidance/colocated.diff) and [separate diff](probes/project-setup-guidance/separate.diff) show the exact additions. The real policy loader reported no problems; matcher assertions checked every named control. Tests are only estimated from config here, not runner-listed. No instruction file changed.

**Inferred verification procedure, not executed on the fixtures:** after an authorized real change, read the config back and check its diff, run `squeal setup --check`, then read affected `squeal status --wait 60000 <changed-source>...` and `squeal code <source>...`. Confirm current test results and which functions remain measured. Report unknown/pending results and run checks outside Squeal according to project policy. A coverage config edit can affect more tests than the named source, so inspect the remaining global counts too. No routine full-suite checkpoint follows from this workflow.

## Cost, limits and remaining decisions

**Verified by experiment.** Two scratch projects took 2.43 seconds in the retained run. There were eight Squeal CLI calls, six fixture git calls and one commit lookup. Source APIs also read facts and policies. The draft has five workflow steps; this is not a count of model turns. CLI output totaled 14,178 characters across both layouts. The draft is 2,742 characters; fixture texts total 1,689 and diffs 625.

**Inferred estimate:** at four characters per token, the draft is about 680 tokens. Reading the draft once, both fixtures, all CLI output and both diffs is about 4,800 tokens, excluding source review, reasoning, tool wrappers, responses and the report. This is a text-size estimate, **not measured billed tokens**. A fresh agent's task success, turn count and token cost are **not measured**. This researcher wrote the fixtures and already knew their intended roles.

**Verified by experiment / limitation.** The experiment window was under 20 minutes. Load was 38.63 on 24 CPUs before probes and 44.62 in the retained run, so expensive runs were skipped as required. No scratch daemon, test run, coverage collection, lint, build, full suite or nested model session ran. Live affected-check behavior, dynamic configs, monorepos, pytest, node:test and coverage limitations were read, not reproduced here. The probes prove path and plan behavior only.

**Inferred recommendation for the later decision:** authorize only a short setup reference and small entry-point link, plus corrections to existing policy/command references for current runner and lint support. Keep current exclusions, defaults, gates and CLI behavior. Decide later whether approved coverage edits remain a reviewed manual diff or gain a command-owned plan/apply path. This research does not settle that interface. A separate skill and a fresh-session evaluation can wait until a distinct usage need or evaluation budget is approved.

## Sources

All source reads use the commit above. No open-web search or external model evaluation ran. Repository URLs are pinned for audit; local files were the material read.

- **S1:** [setup skill](https://github.com/hearsay-tools/squeal/blob/d4fb461149952329b8bb1c62f69d0dd6f2c7896b/plugins/codex/skills/setup/SKILL.md), its identical `plugins/claude-code/skills/setup/SKILL.md`, both sibling `skills/squeal/SKILL.md`, and `references/{policy,commands,reports}.md`.
- **S2:** [plan source](https://github.com/hearsay-tools/squeal/blob/d4fb461149952329b8bb1c62f69d0dd6f2c7896b/src/cli/setup/plan.ts), sibling `repo.ts`, `runners.ts`, `command.ts`, `questions.ts`, `config-edit.ts`; `src/core/daemon/runner.ts`.
- **S3:** `src/core/types/policy.ts` defaults; `src/core/daemon/policy.ts`; `src/core/keys/glob.ts`; `src/core/code/crap/checks.ts`; `src/runners/{vitest,node-test}/coverage.ts`.
- **S4:** `docs/specifications/015-coverage-complexity/spec.md` D1/D6/D8/D9/D10, `status.md` decisions of 2026-10-26/27, `lessons.md` Round 2 C5. These are project documentation, not new measurements in this report.
- **S5:** `docs/specifications/005-agent-adoption/spec.md` D3 and the named setup/operational skill sources above. The report's experiment evidence is `probes/project-setup-guidance/results.json`.
