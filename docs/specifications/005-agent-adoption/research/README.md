# Research brief for spec 005: agent adoption

Squeal has no value if agents ignore it. Under the 001 plugin agents ran tests themselves in 5 of 18 and 7 of 17 editing sessions, and in 004 and 002 dogfooding they ran the whole suite because the repository's gate asked for pasted output. This round finds out why, and which lever changes it: words in the repository's instruction files (the human's proposal: an install step that offers a line in `AGENTS.md` or `CLAUDE.md`), the plugin's own texts, or hooks that take over a test command (the human's earlier idea, opt-in only). `../status.md` records both proposals and the coordinator's unprobed first reading of the hook.

Read `docs/vision.md` (principles 1, 3, 5 and 8, and "Policy-driven checkpoints"), `docs/styleguide.md`, `../status.md`, spec 001 D6, D7, D9 and D11, spec 002 D2 and D3, `src/harness/shared/primer.ts`, `plugins/claude-code/skills/squeal/SKILL.md`, and the parts of `001-core-loop/lessons.md` ("Setup", "What agents did with deliveries", "What agents did"), `002-codex-adapter/lessons.md` and `004-slow-suites/lessons.md` that record what agents did.

## Rules

As in `../../003-node-test-runner/research/README.md`: one to three pages per topic in `research/<topic>.md` (questions answered as a table, findings per question, recommendation, open questions, sources); every finding tagged `verified by experiment`, `read in official docs`, `read in source code` or `inferred`, with the version examined; throwaway probes under `research/probes/<topic>/` with a README and `node_modules` ignored; no product code; nothing touched outside this research folder. Do not design Squeal; answer and recommend.

Probes run under one `/tmp` directory of your own, against copies: never this repository's Squeal store, never another worktree, never delete or kill what you did not start. Agent sessions used as subjects (`claude -p`, `codex exec`) follow 001 `lessons.md` "Setup": pinned harness versions, the parent session's `CLAUDE*` and `CEZ_*` variables removed, the plugin loaded from a pinned copy of this commit (the installed Codex plugin follows main and changes under you), the same prompt per condition. At most 40 subject sessions per topic; record the cost. Subject models: Claude Code with `claude-sonnet-5-5` (as in 001's dogfooding) and Codex with its default model; never Fable.

## Topic: adoption-baseline

Why do agents run tests themselves today, and how will we know when that changes?

1. Every agent-initiated test run in the dogfooding record (the lessons of specs 001 to 004, and the transcripts they name where still on disk: `~/.claude/projects/`, `~/.codex/sessions/`, Cezar run logs): command, scope (full suite, files, name pattern), wall time, the stated or evident reason (a repository gate, confirming a fix, Squeal had not reached the file, distrust of a header, no daemon, none stated), and what Squeal knew at that moment where the record shows it. A table, then counts per reason.
2. Which of those runs were redundant (Squeal held a current result for every file the run covered) and which found something Squeal had not reached or had wrong (002 `lessons.md` defect 5). That second list is the value of the agent's own run as a cross-check: say what removing it would have cost.
3. A metric for the spec's proof: per session, agent-run tests by scope, redundant runs, Squeal pulls and waits, false claims about test state at the end. How to compute it from Claude Code `stream-json`, Codex JSON events and the store without reading transcripts by hand; one script under `probes/` run over the record you found.
4. Prior art on agent-facing tools winning use over habit. Read at named versions: what onboarding writes into instruction files (beads' `bd onboard` or `bd setup`, Nx's `configure-ai-agents`, Serena's onboarding), the `agents.md` convention, Claude Code's memory docs (`CLAUDE.md`, imports, whether and how `AGENTS.md` is read, the built-in `cc-plugin-agents-md` seen in 001's setup), Codex's `AGENTS.md` docs, and how skill descriptions trigger in both harnesses. One paragraph each with what Squeal can reuse.

Recommendation: the reasons ranked by how many runs they explain, the metric, and which levers the evidence points at.

## Topic: instruction-surfaces

Which words, in which place, change what an agent does?

1. The surfaces an agent reads and when: the repository's `CLAUDE.md` and `AGENTS.md`, the SessionStart primer, the registration header, the skill's description and body, report texts, `squeal --help`. For each, in Claude Code and in Codex at pinned versions: does it reach the model, at which point, and does it survive compaction and reach subagents.
2. Controlled sessions on a fixture shaped like 001's (`lessons.md` "Setup": a small Vitest project with one slower file, the plugin active, the daemon warm), on tasks where checking the tests is natural. Conditions: (a) the plugin alone; (b) the plugin plus a repository instruction block, the human's proposal; (c) a repository gate demanding pasted `npx vitest run` output, as this repository's `CLAUDE.md` does; (d) that gate reworded so Squeal can satisfy it (for example a full-suite checkpoint through `squeal run --all --wait`, or `stop.requireFullSuite`). Both harnesses. Per session: the test commands the agent ran (scope, wall time), Squeal pulls and waits, total wall time, and whether its final claim about tests was true.
3. The block the install step would write: two or three wordings tried in condition (b). It must read right when the plugin is absent or broken (then run the tests), must not contradict a gate already in the file, and should be short. Report the length and the measured effect of each.
4. The install step's shape: where it lives (`squeal init`, see the board's Later entry "`squeal init` with a harness choice"; a skill; an offer at a repository's first session), how it asks the human, a managed block with markers that upgrades and removes cleanly, which file for which harness, and what it does with an existing gate. Read 002's install notes and `src/cli/init.ts`.

Recommendation: the surfaces worth using, the text for each with its measured effect, and the install step's shape.

## Topic: hook-levers

What can hooks do when words are not enough, and what does each lever cost in honesty?

1. Claude Code `PreToolUse` at a pinned version: `updatedInput` on a `Bash` test command. Does it need `permissionDecision` `allow` or `ask`; does `allow` skip the user's permission prompt or override their deny rules; what the transcript and the model see. The handler's `if` field (`"Bash(npx vitest *)"`) and its cost per Bash call beside the `sh` gate of 001 D9. Probe each.
2. Codex `PreToolUse` at a pinned version: is input rewriting honored at all (`updatedInput`, `allow`, `ask`)? Read the source and probe; 002 `research/codex-hooks.md` verified only deny.
3. The substitute. What the rewritten command runs so that its answer is as strong as the run the agent asked for: `squeal run --all --wait` (001 D5 queues only files without a current result), with `--force`, or a per-file wait for `npx vitest run <files>` (no such command exists: say what it needs), each bounded under the Bash tool's timeout. Which commands are safe to take over and which never are (`-u`, `--coverage`, `-t`, reporters, watch mode, chained commands, scripts doing more than Vitest), and the states that must fall through to the real run (no daemon, no install, unknown results).
4. Softer levers, probed: a deny whose reason is the current status (001 `research/claude-code-integration.md` 2: a deny does not steer); `PreToolUse` `additionalContext` if the version has it; a `PostToolUse` note after an agent's own run saying what Squeal already held; Stop with `stop.requireFullSuite` as the final gate Squeal runs instead of the agent.
5. How models react, a few controlled sessions per lever in both harnesses: do they accept a substituted result, retry with a variant, distrust Squeal, or stall, and does anything mislead them about what ran.

Recommendation: the levers ranked by measured effect and honesty cost, the command-matching rule, the substitute, the opt-in policy key, and what stays off by default.

## Topic: cli-distribution

Added 2026-10-09 after the spec's approval. The human: someone who knows Squeal should set a fresh repository up from the terminal before starting an agent (`squeal init`, the Codex trust step `squeal init --harness codex --trust`, a warm-up run), perhaps as one `squeal setup`, and setup should offer the warm-up. Today the CLI ships only inside each plugin, at a per-version path (`~/.claude/plugins/cache/hearsay/squeal/<version>/`, `~/.codex/plugins/cache/hearsay/squeal/<version>/`), and is on the PATH only in Claude Code's Bash tool. Read `../spec.md` D3, `../status.md`, spec 001 D8 to D10, `src/cli/init.ts`, `src/cli/start.ts`, `src/cli/run.ts`, `src/core/daemon/lifecycle.ts`, `001-core-loop/research/release-hub.md` and `docs/process.md` 6a.

1. Plugin updates at pinned harness versions: what triggers one in Claude Code and in Codex (auto-update, manual commands, session start); what happens to the old version's directory and to running sessions; user- and project-scope installs of different versions side by side. What a PATH shim sees across an update: one that resolves the plugin at each call (`installed_plugins.json`, the Codex cache) against one written once. Probe in a scratch `HOME`.
2. Distribution options, each with its install command, who updates it and when, the Node requirement, and the version-skew cost: (a) the CLI only in the plugins, plus a resolving shim; (b) a separately installed CLI (npm global or `npx`, a single binary through Node SEA or similar, Homebrew) beside the plugins' own copies; (c) the CLI as the product entry that installs and enables the plugins itself. For skew, probe two Squeal versions on one store (release 0.1.62 and this commit): an older CLI's daemon under newer hooks (the step-down, 001 D10), and a newer CLI's store schema under older hooks.
3. A terminal `squeal setup`: its steps (harness detection, init, Codex trust, warm-up), what it asks, how it runs non-interactively; whether a warm-up started from the terminal survives the first agent session's hooks (a step-down mid-run, the 60-minute idle exit of a `squeal start` daemon), and its cost on a small fixture.
4. Prior art at named versions: beads (`bd` and `bd setup <agent>`), Nx, Serena (`uvx`), and one more tool their docs lead to that ships a CLI and agent hooks: how each is installed, updated and kept in step with its agent integration.

Recommendation: the distribution; the update story in one paragraph per user (a first-time user, a user who knows Squeal in a fresh repository, a collaborator joining a set-up repository, an orchestrator creating worktrees); the `squeal setup` flow and the skill's place beside it.

Load: the host is loaded by this project's other coordinators. Run no test suite of this repository and warm up no large repository; small fixtures only, at most 5 agent subject sessions, and record the load average beside every timing.
