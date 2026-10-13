# End to end for setup with the real CLIs

Board row 005-17, 2026-10-13. Spec 005 Testing, the "End to end" bullets, on the candidate's `install.sh`, launcher, `squeal update`, `squeal setup` and setup skill, run with the real `claude` and `codex`. Suite: `test/real-cli/`, run with

```sh
npx vitest run --config vitest.real-cli.config.ts                      # bullets 1 to 4
SQ_REAL_CLI_MODELS=1 npx vitest run --config vitest.real-cli.config.ts test/real-cli/skill.real.ts   # bullet 5
```

There is no npm script: `package.json` is a key source (`test/keys`), so a script would re-pin the key format (the coordinator's decision C). The files end in `.real.ts`, outside `vitest.config.ts`'s include: CI and the Squeal daemon never run them. `SQ_REAL_CLI_CANDIDATE` names the commit under test (default `HEAD`), `SQ_REAL_CLI_NODE` the subject's Node (22 or 24), `SQ_REAL_CLI_KEEP` keeps each case's directory.

## Versions and candidate

| | |
|---|---|
| Candidate | this branch's HEAD; `plugins/**` and `install.sh` unchanged from `00c98842`, plugins 0.1.151 |
| Claude Code | 2.1.296, `/home/squeal-e2e/.npm-global/bin/claude` |
| Codex CLI | 0.160.1, `/home/squeal-e2e/.npm-global/bin/codex` |
| Node, subject | 22.23.3 and 24.21.0 (`/opt/squeal-e2e/node22`, `node24`) |
| Node, suite | 24.21.0 |
| git, sh | 2.43.0; dash |
| Host | Linux 6.8, 24 CPUs; one-minute load 2 to 113 during the runs (this project's other coordinators) |

## Isolation

Scratch `HOME` variables alone are not isolation: a harness's own setup code may ignore them (the probe-isolation rule). By the coordinator's contract every subject command runs as the throwaway OS user `squeal-e2e`, which cannot enter `/home/agent`, through one function, `runIsolated` (`test/real-cli/isolated.ts`):

```
sudo -n [--preserve-env=<names>] -u squeal-e2e -H env -i HOME=… PATH=/opt/squeal-e2e/node<22|24>/bin:… <scratch vars> /bin/sh -c 'cd "$1" && exec "$@"' sh <cwd> <cmd> …
```

spawned with cwd `/`. Before each spawn a guard refuses: a case root other than `/home/squeal-e2e/runs/<id>`; a `HOME`, `TMPDIR`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` or `XDG_RUNTIME_DIR` that resolves to the real home or lies outside the case; a PATH entry or cwd outside the case; any variable outside an allow-list; a value holding a credential. Each case also checks that no `.git`, `CLAUDE.md`, `AGENTS.md` or `.claude` sits above it (`evals/lib/root.mjs`'s markers). The candidate goes in by `git archive` piped to `tar` as that user. Credentials, for the model sessions only, pass by name through `--preserve-env` (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`; the Codex provider's `env_key`), never in argv; the Codex provider's allow-listed fields go into the case's `CODEX_HOME/config.toml` through `evals/lib/scratch.mjs` `codexConfig`. Every output is redacted with `secretsOf` (the Codex provider URL included) before it prints or is kept.

Teardown stops each fixture's daemon (`squeal stop`, 60 s allowed for 001-340's lock wait), kills whatever names the case root, and removes the case. One leak happened before the fix: a probe killed by `timeout` left the hub server running for 7 minutes, which the coordinator killed. The server now exits when the suite's process is gone (a kill-0 of it answers ESRCH), after 15 minutes without a request, or after 3 hours; an `afterAll` disposes every machine still open. Verified by SIGKILLing a probe: the server was gone within 10 s.

### The hub

The brief asked for a `file://` hub. Neither CLI takes one: `claude plugin marketplace add file:///…` says "Invalid marketplace source format", and `codex plugin marketplace add file:///…` says "expected owner/repo, a git URL, or a local marketplace path" (both *verified by experiment*). A local path works for `add`, but `codex plugin marketplace upgrade hearsay` then fails with "marketplace `hearsay` is not configured as a Git marketplace", so `squeal update` cannot be tested through one. A Git hub over dumb HTTP fails Claude Code's shallow clone ("dumb http transport does not support shallow capabilities"). So each case serves its hub repository over smart HTTP: `git http-backend` behind a Node server on 127.0.0.1, run as `squeal-e2e`. The hub's entries are `git-subdir` sources whose URL is `file://` to a tool repository holding the candidate's `plugins/` (as 005-04's probe did), which both CLIs fetch. Nothing comes from `hearsay-tools/marketplace`. A later version (`publish`) is a commit of the tool repository with the manifests and the bundles' built-in version raised, and a new pin in the hub.

## Results per bullet

| Bullet | Test | Node 24 | Node 22 |
|---|---|---|---|
| 1. `install.sh` with both harnesses and each alone: plugins installed, launcher on the PATH, a second run changing nothing, `--uninstall` leaving nothing | `install.real.ts` (4 tests, including a plugin installed before `install.sh`, which `--uninstall` leaves and names the command for) | pass | pass |
| 2. The launcher across a plugin update in each harness, `squeal update` bringing two versions to one | `update.real.ts` (2) | pass | pass |
| 3. `squeal setup` proposes `plugins/**` (this repository) and `packages/cezar/dist/**` (cezarion), each with its evidence | `setup.real.ts`, bullet 3 (3) | 1 pass, 2 fail: defect 1 | same |
| 4. `squeal setup --yes` with every choice: files match the plan, the warm-up leaves every file current, a first session runs nothing more, a second setup reports nothing outdated | `setup.real.ts`, bullet 4 (2) | pass | pass |
| 5. The setup skill in `claude -p` and `codex exec` with the answers in the prompt | `skill.real.ts` (4 sessions) | 3 pass, 1 fail: defect 4 | not run (Sessions) |

Node 22, the whole file set: 9 passed, 2 failed (bullet 3, defect 1), 4 skipped (bullet 5), 181 s, load 24 at start. Node 24: the same per file (install 40 to 79 s, update 23 to 32 s, setup 53 s).

Bullet 4's "first session" runs the installed plugins' own SessionStart hooks, Claude Code's (`node <installPath>/dist/session-start.mjs`) and Codex's (its `hooks.json` command with `PLUGIN_ROOT`), with a session's input; no run was added in the 20 s after. Its second setup follows a commit of the files the first named ("Commit these when they look right"): before that commit, cezarion's new `squeal.config.json` is untracked, and `--check` rightly calls it outdated. The bullet 5 sessions are the real first sessions.

## Sessions

Bullet 5, on the coordinator's go, 2026-10-13 22:18 to 22:21 local, subject Node 24.21.0, plugins 0.1.151. Four sessions, no retry. Each started only while the one-minute load was below 24 (the test refuses otherwise); the first waited a few minutes for it. Prompt: `/squeal:setup` (Claude Code) or `$squeal:setup` (Codex), then "My answers to every setup question, so do not ask them: …" with every answer (`ANSWERS` in `skill.real.ts`). Claude Code: `claude -p --model claude-sonnet-5-5 --output-format stream-json --verbose --permission-mode bypassPermissions`. Codex: `codex exec --json -s danger-full-access --skip-git-repo-check -m gpt-6-luna`, default effort. Transcripts, redacted and scanned (0 of 14 credential values found), are kept outside the repository under `/tmp/sq-rc-out`.

| Harness, model | Fixture | Load at start | Wall time | Turns | Cost, tokens | `setup --yes` flags the model gave | Result |
|---|---|---|---|---|---|---|---|
| Claude Code, `claude-sonnet-5-5` | this repository | below 24 | 13.9 s (Claude Code's own `duration_ms`) | 3 | $0.108; 6 in, 960 out, 62,034 cache read, 36,835 cache write | `--block CLAUDE.md --gate CLAUDE.md:3=reword --slow 'test/e2e/**' --input 'test/e2e/**=plugins/**'`, both harnesses, `--no-warmup` | pass |
| Codex, `gpt-6-luna` | this repository | 20.9 | 35 s | 1 | 114,149 in (87,296 cached), 2,151 out (561 reasoning) | `--slow test/e2e --input test/e2e=plugins/**`, the rest as above | **fail**: `slow.include` is `["test/e2e"]`, which marks no file slow (defect 4) |
| Claude Code, `claude-sonnet-5-5` | cezarion | below 24 | 12.7 s (`duration_ms`) | 6 | $0.071; 10 in, 1,170 out, 161,205 cache read, 17,170 cache write | `--block AGENTS.md --slow 'packages/cezar/test/e2e/**' --input 'packages/cezar/test/e2e/**=packages/cezar/dist/**' --input 'packages/cezar/test/unit/**=none'` | pass, after the model removed the literal `"none"` input setup wrote, by hand (defect 4) |
| Codex, `gpt-6-luna` | cezarion | below 24 | under 40 s | 1 | 71,727 in (49,920 cached), 906 out (174 reasoning) | `--block AGENTS.md --slow 'packages/cezar/test/e2e/**' --input 'packages/cezar/test/e2e/**=packages/cezar/dist/**'` | pass |

Load and wall time of three sessions are bounds: Vitest prints a passing test's console only on failure, so only the failed one's line survived. `skill.real.ts` now writes `<shape>-<harness>.meta.json` beside each transcript (start, load, exit, wall time) for the release run. Codex reports no cost, only tokens.

Every session found the skill (`squeal:setup` in Claude Code's init `slash_commands`; Codex ran the plugin's CLI by path, as the skill says), read the plan and the questions, applied once with `--yes --no-warmup` and one flag per answer, showed the diff and committed nothing; Codex trust reached `trusted` in all four. In the Codex session on this repository's shape the model then followed the gate line setup had just reworded: `squeal run --all --wait 110000` exited 3 with "No verdict: no daemon running … start one with squeal start" (Codex trusted the hooks during that session, after its SessionStart had been skipped), so it ran `npx vitest run`, as the reworded line says, and the fixture's missing `lint`, `typecheck` and `build` scripts. That run was the model's, not setup's warm-up.

Bullet 5 ran on Node 24 only: four sessions of a budget of eight, and the Node 22 subject differs from Node 24 only below the CLI, which bullets 1 to 4 cover on both.

## Defects

**1. The default input is the union of every sibling candidate, not the artifact the spec names (bullet 3).** D3 "Slow tests and their inputs" step 3: "The default is the broader directory"; Testing: setup "proposes `plugins/**` for this repository's `test/e2e` and `packages/cezar/dist/**` for cezarion's e2e". When no candidate lies over the others, `inputQuestion` (`src/cli/setup/questions.ts`) offers all of them joined as the default. *Verified by experiment*, `squeal setup` without a terminal, 0.1.151:

- Cezarion's shape: candidates `packages/cezar/dist` (bin, exports, files weak, build script, named), `packages/cezar/scripts` (files, weak) and `packages/cezar/web/dist` (files weak, named). Default: `1. packages/cezar/dist/** and packages/cezar/scripts/** and packages/cezar/web/dist/** (default)`; `packages/cezar/dist/**` alone is choice 2. `scripts` is source (005-04 question 7), so with `--yes` every edit there re-runs the e2e group.
- This repository's shape without its declared `inputs`: candidates `dist` (bin, files weak, build script, named) and `plugins` (files, weak). Default: `1. dist/** and plugins/** (default)`; `plugins/**` alone is choice 3. Root `dist` is the wrong artifact (005-04).
- This repository's shape as it is, with `inputs` declared for `test/e2e`: no input question; the plan says the declared inputs hold `plugins` (`inputsHoldArtifact: true`). This test passes.

The union never leaves the right artifact out, which D3 calls the costliest failure, so the choice is defensible; it is not what the Testing bullet says. 005-04 left "the broader directory" undefined for siblings and offered two answers: ask per candidate, or offer the union. A planned row decides: rank by strong evidence (`bin`, `exports`, build script; `files` weak, `named` weak when it counts false hits, below) and default to the best-supported candidate, or amend the bullet to the union.

**2. The warm-up says nothing while the slow tier waits for load (seen in bullet 4).** `squeal setup --yes` on this repository's shape, at a one-minute load of 50 to 76 on 24 CPUs, printed `squeal warmup: 1 of 3 test files done` and then nothing until the probe's 300 s bound killed it. Reproduced on purpose with `slow.maxLoadPerCpu` 0.0001: `squeal warmup` printed the same line and nothing for 90 s, while `squeal status` said `Slow tier: 2 test files; 2 pending, waiting for host load to drop` (*verified by experiment*). The slow tier defers each slow file up to `maxDeferMs` 600 s while the load per CPU is above `maxLoadPerCpu` 1 (004 D3). D3 says the warm-up "prints how many of them are done as it goes"; it does, but a user on a busy host sees a stall of up to ten minutes with no reason given. A planned row: the warm-up names the wait (the status line's words), or runs its slow files as `run --slow` does.

**3. The "named" evidence counts a test file for an artifact its string does not name.** Cezarion's shape: `packages/cezar/dist` is "named by 2 of 2 test files, such as "web/dist/index.html"", but `package-cli.test.ts` names only `web/dist/index.html`, under `packages/cezar/web/dist`, which is listed separately "named by 1 of 2". This repository's shape: root `dist` is "named by 2 of 2 test files, such as "plugins/codex/dist/cli/squeal.mjs"", the false hit 005-04 predicted. Both strings contain `dist/`. The example quoted and the count mislead the human the question is for. Minor; same row as defect 1.

**4. `squeal setup` writes a `--slow` or `--input` value that selects nothing, and `--check` passes it (bullet 5).** The skill's table gives `--slow <glob>` and `--input <glob>=<dir>/**`, and `--slow none` and `--harness none` exist. Two of four model sessions gave values setup should not have taken as they were, and setup wrote them as given:

- Codex on this repository's shape: `--slow test/e2e --input test/e2e=plugins/**`. `slow.include` became `["test/e2e"]`, a directory, which matches no test file: the group stays not slow, so the user's "run test/e2e in the slow tier" was silently not applied.
- Claude Code on cezarion's shape: `--input 'packages/cezar/test/unit/**=none'` for the group answered not slow, following the skill's "once you give one, give them for each group". `inputs` gained `"packages/cezar/test/unit/**": ["none"]`; the model saw it and removed it with `Edit`.

Reproduced without a model, 0.1.151 (*verified by experiment*): `squeal setup --yes --slow packages/cezar/test/e2e --input packages/cezar/test/e2e=packages/cezar/dist/** --input 'packages/cezar/test/unit/**=none'` exits 0; the plan then reads the e2e group `declaredSlow: false` with `declaredInputs: []` (the input's key matches no file either), the unit group `declaredInputs: ["none"]`, and `--check` names neither (it exits 1 only for the untracked config). A planned row: refuse, or normalize, a `--slow` or `--input` test glob that selects no test file and a directory given without `/**`; take `--input <glob>=none` as "no input", or refuse it; `--check` names a `slow.include` or `inputs` key that selects no test file; the skill's table says how to answer "none" for an input.

## Notes

- `squeal setup --yes` with both harnesses prints Codex's install hint ("Each user installs the Codex plugin once… `codex plugin marketplace add hearsay-tools/marketplace`") twice, though Codex already has the plugin. Cosmetic.
- The `.claude/settings.json` setup writes names `hearsay-tools/marketplace` (`source: github`) whatever marketplace the plugin came from; with the hub private (open question 11), a collaborator without access cannot follow it.
- Cezarion's shape runs its `test/` files under node:test (`node --import tsx --test`) and keeps Vitest to `src/`, as cezarion does; with Vitest-style files there, the warm-up reported three files that did not load (`Cannot find package 'tsx'`), a fixture error, not Squeal's.
- An `inputs` glob for an empty `packages/cezar/dist` gets the note `inputs glob "packages/cezar/dist/**" matches no file`, as expected for an unbuilt worktree.
