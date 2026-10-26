# Throwaway project setup guidance probes

Research only for row 015-90. These files are not a skill, product test suite or approved configuration change.

Run from the repository root with its existing dependencies:

```sh
node --import tsx docs/specifications/015-coverage-complexity/research/probes/project-setup-guidance/probe.mts
```

The probe creates two temporary git repositories, with separate and colocated Vitest test paths. Fixture source texts are embedded in the script and retained in `results.json`. It uses the committed Claude Code CLI bundle for `setup --plan --json`, non-terminal `setup`, and `setup --check --json` before and after a scratch config change. The source policy loader, repo-facts reader and coverage glob matcher check the proposals. It captures config diffs, checks that read-only calls change no scratch files (including `.git`), and removes both scratch repositories in `finally`.

- `draft.md`: the five-step guidance this researcher followed. No nested agent session.
- `results.json`: version, commit, time, load, subprocess calls, fixture contents, plan projection, questions, effective policy and path matches. `estimatedTest` comes from static config text, not a runner listing. The plan projection omits host-specific harness paths.
- `separate.diff`, `colocated.diff`: reviewable config changes applied only to temporary fixtures.

The retained run on Node 24.21.0 / Squeal 0.1.359 took 2.43 s and passed all assertions. An earlier run of the same checks took 1.95 s; the retained run names its static test field `estimatedTest` to avoid implying runner discovery. No fixture dependencies were installed. No daemon, test, lint or coverage run was started. Load exceeded 24 CPUs, so expensive checks were skipped. The scripts declare Vitest 5.0.3 only to give the read-only plan concrete discovery evidence.

The fixture author knows which paths are test support. This demonstrates classification and proposal mechanics, not independent agent reliability. Unknown real-project path roles still need project evidence or an owner decision. These outputs prove neither coverage values nor passing tests.

## Completion check

The repository Squeal check ran after the probe:

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/015-coverage-complexity/research/probes/project-setup-guidance/probe.mts
Revision: 7 · d4fb4611 + 7, dirty
No verdict: no test file's closure holds docs/specifications/015-coverage-complexity/research/probes/project-setup-guidance/probe.mts. Worktree: known failures 0; not current: 830 of 1229 test files (830 unknown)
```

Exit 3. The standalone probe above is the direct verification for this uncovered research script. No repository test pass is claimed. Lint, typecheck and build were not run: this change is documentation and throwaway probes under `docs/`, outside the configured Biome and TypeScript inputs. No product or bundle changed.
