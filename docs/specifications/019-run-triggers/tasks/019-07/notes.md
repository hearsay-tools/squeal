# 019-07 notes: check groups in the policy

Worker cb301eaf, 2026-11-03. Residue for wave 2, which makes the daemon read the groups.

## Seam map

- `src/core/daemon/policy-checks.ts`: the `checks` leaf in `SHAPE`. It checks one entry at a time: its fields, `limits`, a runner or lint selector, a required `name` and `at`, and a name that is unique and is not `tests` or `slow`. Problems name `checks[<index>]`.
- `src/core/daemon/policy-checks-settle.ts`: `settleChecks(policy)`. `loadPolicy` calls it after the merge. It checks what needs other keys or other groups: a `nodeTest` or `pytest` `project` the policy does not have, a lint tool that `lint.tools` does not run, and `after` (unknown name, later moment, cycle). It works to a fixed point, so a group whose `after` names a group that is left out is left out too. Problems name the group by name (`"checks" group "e2e": ...`), because the leaf has already dropped entries and their indices have moved.
- `src/core/daemon/check-groups.ts`: pure. `resolveGroups(policy)` gives the `checks` groups in list order, then the default `tests` and `slow` groups. `groupOf(groups, check)` returns the first group that selects the check. `selects(selector, check)`. `coverageProblems(groups, checks)` is for the daemon to call after it lists files.
- `src/core/types/check-groups.ts`: `CheckGroup` (the file's shape), `ResolvedGroup`, `GroupSelector`, `GroupCheck`.

## Decisions the spec did not settle

1. **Default `slow` group under `slow.trigger: "continuous"` with `stop.requireSlowSuite`.** D2 says "at `stop`". A `stop` group starts only at pause, so a literal reading would stop slow runs after quiet edits. That breaks Goal 2. `ResolvedGroup.stopRequires` records "Stop waits for this group" apart from `at`. For `checks` groups it is `at === "stop"`. For the default `slow` group it is `requireSlowSuite`, and `at` is `edit` (continuous), `pause` (idle) or `stop` (idle with `requireSlowSuite`). Decided by the coordinator (14c91259), 2026-11-03: option A. `stopRequires` is not a user key, and the coordinator amends D2 to match.
2. **Reserved names.** `tests` and `slow` are the default groups' names. A `checks` entry cannot take them, and `after` can name them.
3. **Name form.** A name is `[A-Za-z0-9][A-Za-z0-9_-]*`. Then `squeal run <group>` (D6) never reads a name as a path or a flag.
4. **Required keys.** `name` and `at`. A group with no moment is a problem, not `edit`.
5. **Lint with no group.** A lint check that no `checks` group owns has no group (`groupOf` returns `null`). Lint keeps its own moments (D2: `edit` for the edited file, and the stale whole-program re-lint follows `slow.trigger`). There is no default `lint` group, because the spec's own example names a `checks` group `lint`.
6. **`tests` globs** are relative to the worktree, as `slow.include` is. **`project`** must match the project name exactly. It does not use Vitest's wildcard rule that `vitest.excludeProjects` uses.
7. **`deferUnderLoad`.** A key that is not given takes 1.0 or 600000, today's `slow` defaults.
8. **`quietMs`** is accepted at every moment. The spec defines it only at `edit`. The scheduler decides what it means elsewhere.
9. **D2's "slow marking is not used" note** is in `coverageProblems`, because the loader cannot list files.
10. **A Vitest `project` that does not exist** is found only by `coverageProblems`, because only the daemon reads the Vitest config. `nodeTest` and `pytest` projects are checked at load.

## Found, not fixed

- Today, `pytest[].slow: true` marks no file slow. `PYTEST.slowProjects` returns `[]`, and `slowView` and `slowFiles` callers pass only `policy.nodeTest`. This goes against 004 D1 and 007 D1 ("an entry's `slow: true` marks all of them"). No test sets it. The default `slow` group follows the spec and includes those files. So `groupOf` and today's lanes disagree for such files until the daemon reads the groups. This is outside 019-07's files.
- From this commit until wave 2, a `checks` key is accepted and has no effect. A release in that window would ignore it with no warning.
- `plugins/claude-code/dist` drifts (`test/harness/plugin.test.ts > bundles`), because the policy loader is in the bundles. This row does not own the build.
