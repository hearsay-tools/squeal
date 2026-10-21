# Research 014-17: why `test/e2e/shipped-plugin.test.ts` times out on this host

Row 014-17, brief in `tasks/wave-3.md`. Examined on 2026-10-21, 17:36 to 17:42 UTC, at c8a1fa65b (0.1.240), Node 24.21.0, npm 11.19.0, Vitest 5.0.3, Vite 8.3.2.

**Verdict.** The host's npm cache is stale. The test's own Squeal and the test's isolation are not the cause. `rolldown@1.2.15` was published at 13:10 UTC. The cache refreshed its `rolldown` packument at 14:48 UTC, but it still holds the packument of `@rolldown/binding-linux-x64-gnu` from 2026-10-20 23:19 UTC, which stops at 1.2.14. The fixture installs with `--prefer-offline`, so npm resolves `rolldown@1.2.15` from the fresh packument, cannot find the binding 1.2.15 in the stale one, and drops that optional dependency without a message. Vite then cannot load. The shipped daemon notes `vitest could not start: Cannot find native binding` within 0.2 s of its start, lists no test file, and the test waits out its 60 s bound.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What does the shipped daemon do between SessionStart and its first baseline? | It starts, fails to load Vitest within 0.2 s, completes an empty baseline (`test_files: []`) and then waits. It does not stall. It has nothing to run. | verified by experiment |
| 2 | What does the test not isolate, and does a live daemon hold it? | The real `HOME` reaches the daemon only as `~/.config/squeal/config.json` (unchanged since 2026-10-21 00:07 local). The pool and sockets follow the test's `XDG_RUNTIME_DIR`. The store is in the fixture's `.git`. What is not isolated and decides the result is `~/.npm/_cacache`, which the fixture's `npm install` reads. No live daemon is involved. | verified by experiment, read in source code |
| 3 | Is host load against the 60 s bound the cause? | No. The failure is the same at any load. With the fix, the file passes in 13 s at a 1-minute load of 26.6 to 29.5. | verified by experiment |
| 4 | Why does CI pass, and why did this host pass at 12:19 and 14:37 UTC? | CI's npm cache does not hold this stale pair of packuments. The earlier host runs came before the `rolldown` packument was refreshed at 14:48 UTC. | inferred |

## Findings

**1. The daemon's own notes name the failure.** Run 1 (unchanged test, 17:36:55 UTC, load 13.5 to 25.6, 127 s, both baseline cases timed out at 60.9 s and 60.7 s). A watcher copied each scratch store every 2 s. Both daemons (Claude Code and Codex cases) logged the same three notes 0.2 s after their start, for example:

```
2026-10-21T17:36:58.401Z vitest could not start: Cannot find native binding. npm has a bug related to optional dependencies (https://github.com/npm/cli/issues/4828). Please try `npm i` again after removing both package-lock.json and node_modules directory.; every check of this worktree is unknown until the config loads
2026-10-21T17:36:58.452Z runner testFiles failed: vitest could not start: Cannot find native binding. …
```

The stores had a completed baseline checkpoint with `test_files: []`, 0 test files and 0 results. The daemon's threads were idle (`ep_poll`, 5 % CPU). The fixture's `node_modules/@rolldown` held only `pluginutils`. Its `package-lock.json` named `@rolldown/binding-linux-x64-gnu` only in `rolldown@1.2.15`'s `optionalDependencies`, with no package entry. *Verified by experiment.*

**2. The npm cache holds a mismatched pair.** Read-only, from `~/.npm/_cacache` (index and content):

| Packument | Cached at (UTC) | `latest` | Has 1.2.15 |
|---|---|---|---|
| `rolldown` | 2026-10-21 14:48:10 | 1.2.15 (published 13:10:11) | yes |
| `@rolldown/binding-linux-x64-gnu` | 2026-10-20 23:19:47 | 1.2.14 | no |

Vite 8.3.2 depends on `rolldown` `~1.2.11`, so npm takes the newest version. The repository's own lock pins `rolldown` 1.2.12. The `lightningcss` pair, Vite's other native binding, was cached at the same moment and is consistent today. *Read in npm cache contents.*

**3. One change reproduces it at the npm level.** The test's exact flags (`npm install --prefer-offline --no-audit --no-fund --loglevel=error --legacy-peer-deps vitest@5.0.3 vite@8.3.2`), each with its own scratch `--cache`:

| Scratch cache | Flags | `@rolldown/binding-linux-x64-gnu` | `import("vite")` |
|---|---|---|---|
| holds only the stale binding packument | `--prefer-offline` | missing | `Cannot find native binding` |
| empty | `--prefer-offline` | installed | loads |
| holds only the stale binding packument | `--prefer-online` | installed | — |
| holds only the stale binding packument | `--prefer-offline` plus `rolldown@1.2.12` | installed (1.2.12, no nested copy) | loads |

At `--loglevel=silly`, npm serves the stale packument (`GET 200 … (cache stale)`) and writes no line about the skipped optional dependency. *Verified by experiment.*

**4. One change reproduces it in the test file.** Run 2: the unchanged file with `npm_config_cache` set to an empty scratch directory passed, 7 passed and 1 skipped, in 13.2 s at load 26.8 to 27.6. Run 3: the file with one added install argument, `"rolldown@1.2.12"` (the repository's installed version), against the real stale cache, passed, 7 passed and 1 skipped, in 13.4 s at load 26.6 to 29.5. That edit was reverted, not committed. After run 3 the real binding packument was still the one from 2026-10-20 23:19, so the pin works without a refresh of the cache. *Verified by experiment.*

**5. Why only this file.** The other e2e files copy a fixture install that `test/e2e/install.ts` makes once and keeps under `/tmp/squeal-e2e-cache`. The Vite 8.3.2 keys there date from 2026-10-14 and 2026-10-15, with `rolldown` 1.2.13 or 1.2.14 and the binding present. `shipped-plugin.test.ts` runs its own `npm install` on every run. `install.ts` has the same exposure each time it makes a new key (a Vitest or Vite bump, or a cleared `/tmp`), and its `installed()` check looks only for `vitest` and `vite`, so it would cache an install that has no binding. *Read in source code* (`test/e2e/install.ts`, `recipe`, `installed`, `npmInstall`).

## Recommendation for Squeal

1. **Test fix (recommended).** In `test/e2e/shipped-plugin.test.ts`, install `rolldown@<the repository's installed version>` beside `vitest` and `vite`. That is the same rule the file and `install.ts` already apply to those two: "the repository's own, so the npm cache has it offline". Proven by run 3. Cost: one line plus a comment, and `installedVersion("rolldown")` exported from `install.ts`. The pin follows the repository's lock, so a Vite bump in `package-lock.json` moves it too.
2. **Same pin in `install.ts`'s `recipe()`** for both recipes. A check in `installed()` that `import("vite")` loads in the candidate directory then refuses a broken install instead of caching it. Cost: about ten lines. Not run here; the pin is proven by the same npm probe (finding 3, last row).
3. **Optional fail-fast.** After the fixture's install, load Vite once in `beforeAll`. A broken install then fails with npm's message, not with a 60 s timeout. Cost: about five lines. Not run here.
4. **Host fix (temporary, not recommended alone).** A coordinator-run `npm install --prefer-online` of the binding refreshes the packument and makes today's file pass. It writes the real `HOME`, so this row did not do it. The next `rolldown` release brings the same failure back.

Raising the 60 s bound would not help. The daemon has nothing to run.

## Open questions

- CI's cache state is inferred, not read. CI restores the npm cache with `actions/setup-node` `cache: npm` (`.github/workflows/ci.yml` lines 46, 85, 118), keyed on the lock. Whether its cache holds either packument is not determined, because the cache is not readable from this host.
- The state of the `rolldown` packument before 14:48 UTC is not determined, because cacache keeps one index entry per key. That it stopped at or below 1.2.14 is inferred from the passes at 12:19 and 14:37 UTC.
- Three leftover `/tmp/squeal-ship-*` directories from 2026-10-14 to 2026-10-17 hold no live process. They are unrelated and were not touched.

## Sources

- `test/e2e/shipped-plugin.test.ts` (`beforeAll` install, `until`, the 60 s baseline wait), `test/e2e/install.ts`, `test/harness/bundle-helpers.ts` (`runNode` passes the real `HOME`), `src/core/daemon/user-config.ts`, `src/core/slow/slot.ts` (`slowSlotDir`), `src/core/store/paths.ts`, all at c8a1fa65b.
- `~/.npm/_cacache/index-v5` entries `make-fetch-happen:request-cache:https://registry.npmjs.org/rolldown` and `…/@rolldown%2fbinding-linux-x64-gnu`, with their content, read without writing.
- npm/cli#4828, as cited by the error text: https://github.com/npm/cli/issues/4828 (not fetched).
- Probes (throwaway, outside the repository): scratch caches under `/tmp/cc4c-npm/`; the store-copy watcher and readers under the task's scratch directory. Run outputs: run 1 at 17:36:55 UTC, run 2 at 17:40:47 UTC, run 3 at 17:41:19 UTC, with the load sampled every 2 s.
