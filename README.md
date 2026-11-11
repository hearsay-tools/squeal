# Squeal

> That's what tests said.

Continuous validation layer for coding agents. Squeal watches the workspace, runs the smallest useful set of checks in the background, and tells the agent only when a check changes state. Push transitions, pull state.

Part of the Hearsay product family.

- Vision: [docs/vision.md](docs/vision.md)
- Process: [docs/process.md](docs/process.md)
- Styleguide: [docs/styleguide.md](docs/styleguide.md)
- Board: [docs/board.md](docs/board.md)
- Specifications: [docs/specifications/](docs/specifications/)
- Decisions: [docs/decisions/](docs/decisions/)

Status: spec 001 (core loop, Vitest, Claude Code) shipped 2026-10-06; see [docs/board.md](docs/board.md) for what is next.

## Install

Once per machine, with Node 22.19 or later and any of Claude Code, Codex and Pi on the `PATH`:

```sh
curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh
```

That is the `install.sh` of the latest release. Or download it, read it, then run it:

```sh
curl -fsSLO https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh
less install.sh
sh install.sh
```

To use one release's script instead, replace `latest/download` with `download/squeal--v<version>`. The script installs the plugin the hub pins, which is the latest release either way, and in Pi the release the script belongs to.

For each of `claude` and `codex` on the `PATH`, `install.sh` adds the hub marketplace and installs `squeal@hearsay` at user scope through that harness's own CLI (`claude plugin marketplace add hearsay-tools/marketplace`, `claude plugin install squeal@hearsay`; `codex plugin marketplace add hearsay-tools/marketplace`, `codex plugin add squeal@hearsay`). It writes nothing under `~/.claude` or `~/.codex` itself. Squeal's Codex plugin is one fixed plugin: its hooks, and a seed runtime that works offline; each release ships Squeal's runtime for Codex as a separate download, so a new release needs no new hook approval. After installing the plugin, `install.sh` runs the seed's `squeal codex-runtime ensure`, which prepares a runtime with no network, then `squeal codex-runtime update --tag squeal--v<version>`, which downloads this release's runtime, checks it and selects it under `~/.codex/plugins/data/squeal-hearsay/` (`CODEX_HOME` moves it). When either step fails, the script names the runtime Codex sessions keep and exits 1, so run it again once GitHub is reachable. Then it copies the newest plugin's or runtime's launcher to `~/.local/bin/squeal` (`SQUEAL_BIN_DIR` overrides) and says how to put that directory on the `PATH` when it is not. With `pi` on the `PATH` it downloads the release tag's source archive (`https://github.com/hearsay-tools/squeal/archive/refs/tags/squeal--v<version>.tar.gz`, about 10 MB) with `curl`, unpacks its `plugins/pi/` into `~/.local/share/squeal/pi/<version>/` (`XDG_DATA_HOME` moves it), and runs `pi install` on that directory, which writes Pi's own settings; it writes nothing under `~/.pi` itself. With only Pi, the launcher comes from that directory. It prints each command before running it, asks nothing and needs no sudo. A second run changes nothing. The hub `hearsay-tools/marketplace` is private for now: the marketplace step needs your access to it and git credentials for GitHub (`gh auth login`, or an SSH key), and when it fails the script says so. The Pi step needs no hub: the repository is public.

Then, in each repository: `squeal setup`. `squeal update` updates Squeal in every harness that has it to one version; in Codex that is the runtime, and the plugin only when it has a release of its own. A Codex session start also looks for a new runtime in the background; a new runtime serves the Codex sessions started after it, and each session keeps the runtime it started with. Claude Code updates only through this or `claude plugin update`. In Pi, which has no update for a local package, it downloads the latest release's `install.sh` and runs `sh install.sh --pi`, which installs that release's directory and `pi remove`s the older ones. It keeps the files of the one before, and of any older one a running process still uses, such as the daemon of a session still open, so a Pi session open across the update keeps working on the version it loaded; `/reload` in that session loads the new one. The next update deletes what is no longer kept. The launcher finds the installed plugin at each call, so it needs no update of its own; in a Codex session it runs the runtime that session started with, and when that runtime is gone it says so and runs nothing else. `sh install.sh --uninstall`, or `curl … | sh -s -- --uninstall`, removes the launcher, the plugins and the Pi package that `install.sh` itself created, which it records in `~/.local/state/squeal/installed`; a plugin or launcher that was there before stays, and it prints the command that removes it. The `hearsay` marketplace stays added, and so do the Codex runtimes, since a Codex session still open may run one; the script names their directory.

Installing the plugin from inside a harness instead: [plugins/claude-code/README.md](plugins/claude-code/README.md), [plugins/codex/README.md](plugins/codex/README.md) and [plugins/pi/README.md](plugins/pi/README.md).

## Removing a worktree

Each worktree has a daemon of its own, which runs that worktree's tests in the background. Before deleting a worktree, run `squeal stop <worktree>`: it cancels the tests in flight, stops the daemon and every process it started, and returns once none of them is left, so nothing of Squeal's holds the directory. It exits 0 then, and 1 when something still runs past its bound, naming what. `git worktree remove` succeeds without it; a tool that refuses to remove a directory a live process holds needs it first. A hook starts the daemon again at the next edit; `squeal stop --until-start` keeps it stopped through edits and Git operations until `squeal start`.

## Slow tests

Slow test files (`slow.include` in `squeal.config.json`, or `"slow": true` on a `nodeTest` or `pytest` project) run in a tier of their own, after the fast ones: once the latest edit's fast tests are done and no edit has come for `slow.quietMs` (default 3000), whether or not the agent is mid-turn, so a slow result reaches the agent with its next tool call; or on `squeal run --slow`. With `"slow": { "trigger": "idle" }` they run only when the agent pauses. They are keyed, run and inherited by another worktree as any test file is. The `Slow tier:` line in `squeal status` says how many there are and which are current, pending, running or not run.

## Tests Squeal does not cover

Squeal covers no test of a build output it does not produce, such as an end-to-end suite that spawns a bundle your build writes: it cannot know when that output is current. Leave those tests out, and run them yourself or in CI:

```json
{
  "vitest": { "exclude": ["test/e2e/**"] }
}
```

`vitest.exclude` lists globs, relative to the worktree root, of Vitest test files Squeal never lists, runs, keys or counts. `squeal status`, `squeal setup --check` and the session's first message name them as not covered. For a node:test or pytest project, its entry's own `exclude` does the same.

## The quality check in CI

`squeal code --base <ref>` checks every JS/TS function that changed since `git merge-base <ref> HEAD`, test callbacks included. It counts each changed function's complexity (CC), runs the test files that load the changed files with Squeal's coverage, and judges each function against `complexity.threshold` (default 20) and `crap.threshold` (default 30) as `squeal.config.json` sets them at the merge base, so a branch cannot loosen its own check. Equality passes. It needs no daemon, no harness and no agent session, writes nothing into the project (a node:test entry's `prepare` command, below, writes what it writes), and stops its tests after `--timeout` seconds in all (default 600). Its exit code is the verdict:

- `0` pass: every changed function is within both limits, or is skipped because its file is in `coverage.exclude`.
- `1` violations: a changed function is over a limit, even when others are incomplete. Simplify it, or test more of it to lower its CRAP score.
- `3` incomplete: Squeal could not measure a changed function, or a selected test failed. Each such function names its gap (see below).
- `2` a usage or setup error, for example a `<ref>` that does not resolve, or a project whose own Vitest does not resolve.

Code that the tests reach only through a process they start, such as a CLI script, is measured when `coverage.children` is `true` in `squeal.config.json` at the merge base (see the [policy reference](plugins/claude-code/skills/squeal/references/policy.md)). Squeal then counts what those processes and the worker threads the tests start run, as a lower bound: a process that is killed, outlives its test file or gets an environment without `NODE_V8_COVERAGE` is not counted. The JSON report says so in `base.policy.coverageChildren` and in each run's `children`. The daemon measures them too, by the worktree's own `squeal.config.json`: a file that only a child runs is judged from the test file that starts it while `observe.runtimeInputs` is on (the default); with it off, it reads not measured.

Test files that need a build first, such as tests that start the project's built CLI, can get it from their node:test entry's `prepare`:

```json
{ "nodeTest": [{ "name": "package", "include": ["test/e2e/*.test.mjs"],
  "prepare": { "command": ["node", "scripts/build.mjs"], "timeoutSeconds": 600 } }] }
```

`squeal code --base` runs the command once, in the entry's `cwd` with its `env`, before the first selected test file of the entry, inside the `--timeout` budget. `command` is an argument list, never a shell string. Its output goes to stderr, and its exit code and duration go in the report's `runs[].prepare`. Squeal then runs the entry's test files itself: the command's success is never evidence. It runs the command as `squeal.config.json` declares it at the merge base, so land a new `prepare` before the change that needs it. The daemon does not run an entry that has `prepare`.

Squeal needs Node 22.19 or later, and the project's own dependencies installed: it runs the project's Vitest, and the node:test projects `squeal.config.json` lists under `nodeTest`.

### Pin one release

A CI job runs one Squeal release that it pins and verifies, with no harness. Each release `squeal--v<version>` has Squeal's runtime as the asset `squeal-codex-runtime.json.gz`, and a descriptor, `squeal-codex-runtime.json`, that names the asset's SHA-256 and the release commit. Read both once, when you choose the version, and write them into the job:

```sh
curl -fsSL https://github.com/hearsay-tools/squeal/releases/download/squeal--v0.1.423/squeal-codex-runtime.json
```

Do not read the descriptor inside the job: a SHA-256 read from the release at run time proves only that the download is whole, not that it is the release you chose. The asset is gzip-compressed JSON, not an archive. The job's `Install Squeal` step checks its SHA-256 and refuses it on a mismatch before it writes anything, then unpacks it with Node into a new directory. The CLI is `dist/cli/squeal.mjs` there. The job caches the downloaded asset under a key that holds both the version and the SHA-256, and checks the SHA-256 again on every run, so a stale or wrong cache entry is refused, never used.

### A GitHub Actions job

```yaml
name: Quality check

on: pull_request

permissions:
  contents: read

jobs:
  squeal-code:
    runs-on: ubuntu-24.04
    env:
      SQUEAL_VERSION: 0.1.423
      SQUEAL_SHA256: 6592435a2d62a3e17f619723f5e1f6098a734320de4192b308a79bf9bd97d651
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the merge base must be in the clone
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - uses: actions/cache@v4
        with:
          path: ~/.cache/squeal
          key: squeal-runtime-${{ env.SQUEAL_VERSION }}-${{ env.SQUEAL_SHA256 }}
      - name: Install Squeal
        run: |
          file="$HOME/.cache/squeal/squeal-codex-runtime-$SQUEAL_VERSION.json.gz"
          if [ ! -f "$file" ]; then
            mkdir -p "$HOME/.cache/squeal"
            curl -fsSL -o "$file" "https://github.com/hearsay-tools/squeal/releases/download/squeal--v$SQUEAL_VERSION/squeal-codex-runtime.json.gz"
          fi
          node -e '
          const fs = require("node:fs"), path = require("node:path");
          const [file, sha256, out] = process.argv.slice(1);
          const bytes = fs.readFileSync(file);
          const actual = require("node:crypto").createHash("sha256").update(bytes).digest("hex");
          if (actual !== sha256) {
            console.error(`${file} has SHA-256 ${actual}, not ${sha256}: refused`);
            process.exit(1);
          }
          fs.mkdirSync(out);
          for (const f of JSON.parse(require("node:zlib").gunzipSync(bytes)).files) {
            fs.mkdirSync(path.dirname(path.join(out, f.path)), { recursive: true });
            fs.writeFileSync(path.join(out, f.path), Buffer.from(f.data, "base64"), { mode: f.mode });
          }
          ' "$file" "$SQUEAL_SHA256" "$RUNNER_TEMP/squeal"
          node "$RUNNER_TEMP/squeal/dist/cli/squeal.mjs" --version
      - name: Check the changed functions
        run: |
          status=0
          node "$RUNNER_TEMP/squeal/dist/cli/squeal.mjs" code --base "origin/$GITHUB_BASE_REF" --json > "$RUNNER_TEMP/squeal-code-gate.json" || status=$?
          jq -r '"Code gate: \(.verdict)", (.functions[] | select(.state != "pass") | "  \(.path):\(.line) \(.qualifiedName) CC \(.complexity) CRAP \(.crap // "none"): \(.state) \(.gap // "")")' "$RUNNER_TEMP/squeal-code-gate.json" || true
          exit "$status"
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: squeal-code-gate
          path: ${{ runner.temp }}/squeal-code-gate.json
```

On `pull_request`, `actions/checkout` checks out the merge of the pull request into its target, so the check judges the change as it would land. The step prints the verdict and each function that is not pass; the uploaded report also names the paths not counted, the failed tests and the test files that did not finish. Use your project's own install command in place of `npm ci`. The cache key matches only the same version and SHA-256, so a new version downloads its own asset. Outside GitHub Actions, the `Install Squeal` script runs as it is in any shell, with `SQUEAL_VERSION`, `SQUEAL_SHA256` and `RUNNER_TEMP` set; the directory `$RUNNER_TEMP/squeal` must not exist yet.

To pin the release's source instead, clone its tag and check the commit that the descriptor names as `releaseCommit`. The clone is about 300 MB and takes about 12 s; the asset is about 5 MB. Cache the clone under a key that holds both the version and the commit:

```sh
SQUEAL_VERSION=0.1.423
SQUEAL_COMMIT=2b2ed97ed4ec4c0200f7a537e26e353131c21ce7
git -c advice.detachedHead=false clone --quiet --depth 1 --branch "squeal--v$SQUEAL_VERSION" https://github.com/hearsay-tools/squeal.git "$RUNNER_TEMP/squeal-source"
head=$(git -C "$RUNNER_TEMP/squeal-source" rev-parse HEAD)
[ "$head" = "$SQUEAL_COMMIT" ] || { echo "squeal--v$SQUEAL_VERSION is at $head, not $SQUEAL_COMMIT: refused" >&2; exit 1; }
node "$RUNNER_TEMP/squeal-source/plugins/claude-code/dist/cli/squeal.mjs" --version
```

The CLI is then `plugins/claude-code/dist/cli/squeal.mjs` in the clone, in place of `dist/cli/squeal.mjs` in the asset's directory.

### When the check says incomplete

Squeal could not judge an incomplete function: its evidence is missing or partial, or a selected test failed, and that never passes. The JSON report's `gap` names why, and the text says it in words:

- `no-loader`: no selected test file loads its file. Add a test that imports it, or add a test file that loads it to the run with `--test <file>`. For a script that tests only start as a separate process, set `coverage.children` to `true` on the target branch and name the test that starts it with `--test <file>`. Code that tests reach only through a browser is not measured yet; list such files in `coverage.exclude` on the target branch, and their functions read `skipped` and keep their CC check.
- `not-finished`: a test file that loads it did not finish in the budget. Make that file faster, or raise `--timeout`.
- `not-prepared`: a test file that loads it did not run, because its node:test entry's `prepare` failed, timed out, or is declared only on this branch. The report's `runs[].prepare` names the entry, its exit code and the files that did not run. Fix the command, raise its `timeoutSeconds` or `--timeout`, or land the declaration on the target branch first.
- `left-out`: a test file that loads it is in a check group this run left out, and the files that ran do not prove a pass, for example because its CRAP is over the limit and more coverage could lower it. By default a group whose moment is `"manual"` is left out; `gate.groups` on the target branch sets the groups in scope. The verdict line names each group that did not run; add `--group <name>` to run it.
- `test-failed`: a selected test failed. The report's `runs[].failed` names it; fix it.
- `skipped`: a test file that loads it skipped a test, so its coverage can prove a pass but never a violation. Run the skipped test, or remove the skip.
- `not-counted`: its file does not parse, or is over `complexity.maxFileBytes`. The report's `uncounted` names the file.
- `no-record`: a test file that loads it finished, but gave no coverage of the file's current bytes, for example because the file changed during the run. Run the check again.
- `not-joined`: Squeal could not match the coverage it has to the function. That is a limit of Squeal's; report it at https://github.com/hearsay-tools/squeal/issues with the JSON report.

No agent session is needed for any of these. Run the same command on your machine, `squeal code --base origin/main`, or the pinned CLI as above, to see the same verdict with each function that is not pass on a line of its own; `--json` prints the report.

## Results from CI

Your CI already runs your tests. With Squeal's GitHub Action, the test step also records each test file's result, and a job after the tests publishes those results on a git ref of your repository. A developer's Squeal fetches the results of the main commit their branch starts from, so a test file that passed in CI at the same content does not run again on their machine. Vitest only, for now.

Set it up once:

1. Pin one exact Node version for CI and developers, for example `26.13.0` in `.node-version` at the repository root. A result counts only on the Node version that recorded it. Squeal's daemon runs the pinned version when it is installed.
2. Set `shared.ref` in `squeal.config.json`. Without it, developers' Squeal fetches nothing:

   ```json
   { "shared": { "ref": "refs/squeal" } }
   ```

3. Add the action and an export job to the workflow that tests main:

```yaml
name: Tests

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-24.04
    strategy:
      matrix:
        shard: [1, 2, 3]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - run: npm ci
      - uses: hearsay-tools/squeal/ci@v0
      - run: squeal ci record --out "$RUNNER_TEMP/squeal-parts" -- npx vitest run --shard=${{ matrix.shard }}/3
      - uses: actions/upload-artifact@v4
        if: github.event_name == 'push'
        with:
          name: squeal-parts-${{ matrix.shard }}
          path: ${{ runner.temp }}/squeal-parts/
          retention-days: 3

  squeal-export:
    needs: test
    if: github.event_name == 'push'
    runs-on: ubuntu-24.04
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version-file: .node-version
      - run: npm ci
      - uses: hearsay-tools/squeal/ci@v0
      - uses: actions/download-artifact@v4
        with:
          pattern: squeal-parts-*
          path: ${{ runner.temp }}/squeal-parts
          merge-multiple: true
      - run: squeal ci export --parts "$RUNNER_TEMP/squeal-parts" --out "$RUNNER_TEMP/squeal-results.json.gz"
      - run: squeal ci publish "$RUNNER_TEMP/squeal-results.json.gz" --keep 100
```

- `uses: hearsay-tools/squeal/ci@v0` puts `squeal` on the `PATH` for the later steps of its job. GitHub checks out Squeal's repository at the tag, with the released bundles in it, so the action downloads nothing else. Put it after `actions/setup-node`: Squeal needs Node 22.19 or later on the `PATH`.
- `squeal ci record --out <dir> -- <command>` runs your own test command unchanged and exits with its code. It also writes one part file per Vitest process into `<dir>`. Recording adds time to the test step. Nothing may change the tests' input files while it runs; `squeal ci record --help` says why.
- `squeal-export` runs only for pushes to main, and only after every shard has passed. In a checkout of the same commit, `squeal ci export` keys the parts as a developer's Squeal keys them, and `squeal ci publish` pushes them as `refs/squeal/<commit>`. In the same push it deletes the refs of main commits older than the newest 100; `fetch-depth: 0` lets it place them on main's history. It is the only job with `contents: write`, and no required check needs it.
- With a merge queue, upload the parts and run the export on `merge_group` events instead of `push`, and check out `github.event.merge_group.head_sha` in the export job: that commit becomes the main commit.
- The export job runs your install with a token that can push. To keep that token away from your dependencies' install scripts, split the job in two: the export, with `contents: read`, uploads `squeal-results.json.gz` as an artifact; a publish job with `contents: write` downloads it (by `pattern`, so a missing file is no error) and runs only `squeal ci publish`, which runs git and reads `squeal.config.json`, with no install.

### Squeal never decides your CI result

- When Squeal cannot run, for example on a Node older than it supports, the action warns in the job log and the step summary, and `squeal` passes through: `squeal ci record -- <command>` runs the command and exits with its code, and `squeal ci export` and `squeal ci publish` do nothing and exit 0.
- When Squeal fails while it records, the command's own exit code still decides the step.
- When `squeal ci export` or `squeal ci publish` refuses or fails, it prints its reason, adds a warning with that reason to the run and the step summary, and exits 0. A stop in sharing shows as a warning on the run, not as a failed job.
- Only a usage error fails a step, for example an unknown option: a mistake in the workflow file, which shows on its first run.

No step needs `continue-on-error`.

### Squeal versions in CI

Every Squeal release moves the tag `v0`, so your CI follows Squeal's releases with no change to the workflow. `v0` stays on releases whose CI setup is compatible: the action's inputs (it has none), the commands it provides and their arguments. A release that would break a workflow written for `v0` starts `v1`, and `v0` stays on the last compatible release. A change in the format Squeal records results in is not such a break: while CI and a developer run releases with different formats, that developer's Squeal does not use CI's results.

To pin one exact commit instead, write the commit of a release in `uses:` and keep the tag in a comment, for example `uses: hearsay-tools/squeal/ci@<commit> # v0`. Renovate keeps such a pin current: with the preset `helpers:pinGitHubActionDigests` it writes the pin itself and opens a pull request each time `v0` moves. Dependabot does not read Squeal's release tags (`squeal--v<version>`) as versions, so it cannot keep this pin current.
