# 017-30 notes: oxlint config discovery skips gitignored folders

Worker ef64a8b2, wave 6 W2, 2026-11-06. Cause: `../../../011-core/research/issue-154-cause.md` F5.

## What changed

`findConfigs(root, timeoutMs?)` in `src/core/lint/provider/oxlint/configs.ts` is now async. Before the walk it runs one `git ls-files --others --ignored --exclude-standard --directory -z` in the root (`runGit`, bounded by the provider's D3 guard, `ctx.guardMs`). The walk skips each folder git names with a trailing `/`. `readConfigs` in `config-set.ts` awaits it. No other caller exists.

This is the same git call the watcher uses to exclude ignored output (001 D2, `src/core/types/watcher.ts`) and `existingIgnoredDirs` in `src/cli/setup/repo.ts`. The pass's ignored list (`LintSource.ignored()`, `offeredSet`) was not used: it lives in `src/core/lint/pass/**` (W1), it names files and not folders, and the provider has no access to it.

## Why the skip is sound

Git names a folder only when every file under it is untracked and ignored (verified by experiment, git 2.43, below). So no file the pass offers is under it (D1), and a nested oxlint config there decides no checked file: a nested config applies only below its own folder. A config that a tracked config `extends`, or a JS plugin it names, is still read through `configFacts`, wherever it is.

Git output, a fixture with `.gitignore` = `.ai/qa/**`, `dist/`, `build/`, `!build/keep/`, `src/inner/.oxlintrc.json`, `mixed/.oxlintrc.json`, `tracked/.oxlintrc.json`:

| Folder | Content | Named as a folder |
| --- | --- | --- |
| `.ai/qa/served/` | a nested clone with its own `.git` | yes |
| `.ai/qa/forced/` | a config and a force-added tracked `a.ts` | no; the config is named as a file |
| `dist/`, `build/` | ignored files only (`!build/keep/` cannot re-include under an ignored parent) | yes |
| `src/` | only `src/inner/.oxlintrc.json`, ignored by its own pattern | yes, with `src/inner/` and the file also listed |
| `mixed/` | an ignored config and an untracked, not ignored `a.ts` | no; the config is named as a file |
| `tracked/` | an ignored config and a tracked `b.ts` | no; the config is named as a file |

Only folders are skipped. An ignored config file in a folder that holds a checked file (the `mixed/`, `tracked/` and `.ai/qa/forced/` rows) still decides that file, so it stays a config and a key input.

When git cannot list the folders, the walk keeps every config, as before: too many keys moved, never a config missed. Two cases seen: no repository (`/tmp`), and a root inside a checkout's ignored folder (`fatal: git ls-files: internal error - directory entry not superset of prefix`, from this host's `TMPDIR` under `.ai/cezar/t/`). The daemon's root is always a worktree's top, so neither is a production case.

## Tests

`test/lint/provider/oxlint/ignored-configs.test.ts` (the brief's folder; it did not exist, the other oxlint tests are in `test/lint/oxlint/`):

1. `findConfigs` on a git fixture leaves out `.ai/qa/served/t1/.oxlintrc.json`, a nested config inside that clone, and `dist/.oxlintrc.json`; it keeps the root config, a tracked nested `pkg/` config, a tracked dot-folder `.storybook/` config (review `reviews/0.1.392.md` B2's shape) and a config beside a force-added file under an ignored pattern.
2. Without git's list, every config is listed.
3. The real oxlint pass over a git listing (`ls-files --cached --others --exclude-standard`, as the daemon lists): a served clone appears, then the pass restarts, then the clone's config changes and the pass restarts again; every check's key and findings stay equal. Then a tracked nested config's change moves its file's key and findings. Before the fix this test failed at the first restart: every key moved (the restart re-reads the configs, as in F4 and F5). Without the restart it passed, because an ignored file never enters a revision, so nothing re-read the configs.

## Decisions the spec did not settle

- No `OXLINT_PROVIDER_VERSION` raise. Keys change only for a root with a config in an ignored folder: such a root re-keys once after the upgrade, and its new keys hold fewer inputs. A key that held no ignored config is computed as before, so no stored result can be reused under a key whose meaning changed. `test/keys/key-format.test.ts` covers test keys, not lint keys.
- A git failure is handled, not reported: the old walk is the sound fallback, and the provider has no log.
- The git call takes the D3 guard (`guardMs`, 5 s by default) as its timeout, so a stuck git cannot hold the provider's queue.

## Not changed, for the next worker

- `isOxlintConfigInput` (used by `pass/refresh.ts` and `rekey.ts` `planOf`) still says `true` for a config path at any depth, ignored or not. A revision seldom names an ignored path: the watcher excludes ignored folders (001 D2) and watches an ignored file only when a closure names it. Not checked here: whether lint key inputs count as such a closure. If a revision did name one, the pass would run one `config` keying: a full `inputs` call that moves no key. Making the predicate ignore-aware needs the ignored list in the pass (W1's files).
- `.gitignore` is not a config input. A folder that becomes ignored or not ignored changes the listing, so its config's path appears in a revision and the configs are read again.
- ESLint's nested-config walk (`src/core/lint/provider/lookup.ts`, D3 step 4) still counts git-ignored folders, by the 2026-11-02 amendment. It only decides whether `v10_config_lookup_from_file` is set; it adds no key input per config. Out of this row.

## D11 sentence to amend

In D11 "Key", after "each folder's config, or none, between the file and the root": "Nested configs are found by a walk that skips `node_modules`, `.git` and every folder git ignores whole (one `git ls-files --others --ignored --exclude-standard --directory` per walk; row 017-30), so a config there is no key input; without git's list the walk keeps every folder."

## Walk cost

*verified by experiment*, probe `configwalk-ignored.mjs` in this folder, 5 rounds each, one-minute load 22.8 and 19.9 on 24 CPUs, warm page cache, 2026-11-06 13:43 Europe/Warsaw. "After" is the git call plus the walk that skips what it names.

| cezarion worktree | Folders read, before → after | Entries, before → after | Before (ms) | After (ms), git + walk | Configs after |
| --- | --- | --- | --- | --- | --- |
| `01e9423c` (the research's) | 2,016 → 221 | 31,809 → 3,521 | 35.7–42.5 | 13.1–19.2 (git 9.1–13.5) | none, as before |
| `00bb4e0f`, a served clone with `.oxlintrc.json` | 749 → 292 | 11,554 → 4,731 | 12.5–20.4 | 15.4–22.3 (git 11.0–13.5) | `.oxlintrc.json`; the clone's left out |
| `2e697ae3`, a served clone with `.oxlintrc.json` | 755 → 289 | 11,822 → 4,709 | 13.3–22.0 | 17.6–20.9 (git 11.6–15.4) | `.oxlintrc.json`; the clone's left out |

Both stay well under the research's 133–307 ms (load 59, cold). Where the ignored folders are large, the new walk is faster; where they are small, the git process start (about 11 ms) makes it a few ms slower. It runs once per config read, not per edit.
