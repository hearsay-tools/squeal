# Review of cand/0.1.276 (011-36)

Use /reviewer. Shape: review. Pinned to the `cand/0.1.276` SHA named in the spawn; the range is `squeal--v0.1.275..<sha>`: 011-36's fix and tests (worker 0e9decac), two test edits the coordinator approved, the `test/version-sensitive.txt` entry, the C2 amendment and status line, and the release commit (0.1.276, bundles; no key-format change).

Read board row 011-36, `tasks/011-36/brief.md` and `notes.md`, 013 `tasks/013-01/design.md` section 4, and spec 011 C2 as amended. Check that:
- a cached gitignored path that nothing names is dropped from the stat cache and the store with no revision, after the first environment read;
- a path that a saved or current closure, an environment file, a former environment file, a lockfile or an observed read names stays watched; a dropped path that a closure names later is hashed again and keyed as before, and no test file is keyed while a closure path is untracked;
- a release before every runner has replaced its saved closures costs at most a re-hash, never a wrong or missing result;
- `#release` judges only paths that a change could leave unnamed;
- `cases/assemble/inherited.ts` runs the changed `keying.ts` lines, and the key format is rightly unchanged;
- `touched-scope.test.ts` case 1 still proves 013-02 T1/T2 with a real namer;
- the version is raised in all eight places, and the bundles match the tree.

Run every test command as `env -u PLUGIN_ROOT -u PLUGIN_DATA ...` until row 011-140 ships: a run that inherits them writes wrong Codex kept copies under `~/.codex`. Run `npm ci`, then `env -u PLUGIN_ROOT -u PLUGIN_DATA flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4` once in the candidate tree. The coordinator's gate at e5905d35e: 951 files passed, 2 skipped; only `test/harness/opencode-dispose.test.ts` failed (held Stop killed at +2245 against +2000), and it passes alone (row 008-38). Known load flake: `test/keys/validity/pytest.test.ts`'s deadline kill (row 011-142). Name a file that fails under load and passes alone; it is a blocker only if you trace it to this range. Write `reviews/0.1.276.md` with a PASS or FAIL verdict and commit it.
