# 005-126 notes: `squeal checks`, a check's description, the primer's form switch

Wave 30 W1, an experiment branch; nothing here ships until the human decides.

## The bundle string (for W2's variants)

After a build on a scratch copy outside the worktree (`git archive HEAD` into `/tmp`,
`node_modules` symlinked, `tsrs --fast -p tsconfig.build.json` and the four
`src/harness/*/build.ts` called directly), the constant survives as one line:

    var PRIMER_FORM = "full";

25 bundles carry it, each exactly once, and each reads it as `primer`'s default
argument (`function primer(command = SQUEAL_COMMAND, coverage = DEFAULT_COVERAGE, form = PRIMER_FORM)`),
so esbuild does not fold it. The bundles:

- `plugins/claude-code/dist/`: post-tool-batch, session-end, session-start, user-prompt-submit (4)
- `plugins/codex-runtime/dist/`: interrupt, post-tool-use, pre-tool-use, runtime, session-end,
  session-start, stop-slow, stop, subagent-start, subagent-stop, user-prompt-submit (11)
- `plugins/opencode/dist/hooks/`: after, before, end-turn, end, ping, prompt, register, stop, wait (9)
- `plugins/pi/dist/worker.mjs` (1)

`plugins/codex/dist` (the adapter) and the CLI bundles carry no primer.
The patches: `var PRIMER_FORM = "full";` → `var PRIMER_FORM = "minimal";` or
`var PRIMER_FORM = "minimal-rules";`, `min` 25.

## `squeal checks`

`src/cli/checks.ts` (the store read) and `src/cli/checks-text.ts` (the text). No daemon,
no write. The store read is `withStatusStore`, the read `squeal status` uses; per
test check it counts the listed files the check owns (`groupView(policy).of`) and,
per file, `fileClassOf`: current and no failing state is a pass, current with one
is a fail, anything else is "not current". Output for the four test configs is in
`test/cli/checks.test.ts`.

Decisions the brief did not settle:

- A lint check has no "Test files now" and no "Last result" line: the lint store is
  another store; `squeal lint` reads it.
- With lint enabled and no lint check in `checks`, a `lint` block prints with
  "Findings: `squeal lint`" in place of a run command: `squeal run lint` has no
  default lint group to run.
- The default `tests` check prints with no store (its count is unknown), and with a
  `checks` key only while the listing has files it owns. The default `slow` check
  prints only where the config marks files slow.
- `after` prints as "Starts after: <names>". A check Stop waits for at another moment
  (the default `slow` under `stop.requireSlowSuite` with `slow.trigger: "continuous"`)
  reads "after each edit; Stop waits for them".
- With no `checks` key, a first line says the config has none and these are the
  default checks.
- The lint group shape problem now names `description` among a lint group's keys
  (`checks-problems.test.ts` updated).

## The form switch

`primer(command, coverage, form = PRIMER_FORM)`. B and C ignore coverage. A Codex CLI
is named in full in the first command and as "the CLI's `x`" after it; a CLI too long
for the cap is unnamed, and one sentence says the commands are the CLI's SQUEAL
messages name. The registration header is unchanged in every form (`withPrimer`).

## For whoever continues

- The committed `plugins/*/dist` is not rebuilt here (the brief: the coordinator
  builds on the branch); CI's drift check fails until it is.
- `docs/` (README, the skill's policy reference) do not yet mention `squeal checks`
  or `description`; that waits for the human's decision.
