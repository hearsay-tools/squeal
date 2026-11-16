# Glob membership (topic glob-membership, row 023-12, 2026-11-16)

A module that uses `import.meta.glob` or a template-literal `import()` loads the files its pattern matches on disk. The closure lists the matched files, but no key part records which files the folder holds. Does this gap reach beyond 023, and which fix owns it?

Short answer: the gap is not specific to 023. With the real Vitest adapter, a daemon restart, a second worktree and a CI import each report a PASS that `vitest run` fails. All four paths key a test file from a stored closure list. Fix A closes all four, and no other change is needed: it records a listing entry for each glob, using the `dir/` entries Squeal already hashes, both on disk and from a commit's tree. An emulation of fix A turns each false PASS into `stale`. Fix A re-keys 0 test files in Squeal and 0 in squawk today, because neither repository's Vitest closures hold a real glob. Fix B as written is a bad trade. Its regex matches comments and strings, so 43.4% of Squeal's and 11.2% of squawk's test files would read `not determined (closure)`, and every one of those matches is false.

Versions. Source read at `75e44e78f` (Squeal 0.1.527), with the held 023-03 code at `990b60650`. The experiments ran the 0.1.527 bundle of this worktree with Vitest 5.0.3 and Vite 8.3.2 on Node v26.13.0. Stores were copied read-only on 2026-11-16 at 22:31Z. Probes and the scenario log are in `probes/glob-membership/`; its README lists each script.

## Questions answered

| # | Question | Answer |
|---|---|---|
| 1 | Does the gap reach other worktrees, CI imports, a restart | Yes, all three (verified by experiment). The live daemon catches the add, so only a key computed from a stored list is wrong. |
| 2 | Fix A: where, cost, key-format raise | The Vitest adapter reads each glob's literal pattern. The core records a `dir/` listing, recursive where the pattern is, in a shared set that keying merges. This re-keys only test files with a glob in their closure: 0 in both repositories today. No key-format raise. No adapter-version raise, if the listing lives in the shared set and not only in the stored list. |
| 3 | Fix B, and other resolution inputs | Fix B covers only 023, and its regex marks 825 of 1,900 and 215 of 1,922 test files with no real glob. `package.json` `imports`/`exports`, a file that shadows a resolved import, and tsconfig `paths` also change a closure with no byte change in listed files. Neither fix covers them. |
| 4 | Frequency | Real glob or template imports in Vitest closures: 0 test files in Squeal, 0 in squawk. Main commits that add or remove a matching file: 0%, because nothing matches. Over 46 days, no real file glob reached either main. |
| 5 | Recommendation | Fix A, owned by the closure. Do not ship fix B's regex. The other resolution inputs are a separate row. |

## 1. The same gap outside 023

All runs in `out/scenarios.log` (verified by experiment). The fixture: `src/registry.ts` globs `./plugins/*.ts`, and `test/a.test.ts` expects one plugin. Each line pairs Squeal's report with what `vitest run` gives on the same tree.

| Scenario | Squeal reports | `vitest run` |
|---|---|---|
| S1: the daemon runs, `src/plugins/new.ts` is added | FAIL `expected 2 to be 1` | fail |
| S2: daemon stopped, file added (untracked), daemon started | PASS, "all 1 test file current" | fail |
| S3: daemon stopped, add committed, daemon started | PASS | fail |
| S4: second worktree at the commit with `new.ts`, first start | PASS, inherited | fail |
| S5a: fresh clone, CI export imported, daemon with `CI` unset | unknown; after a second import, "content differs" | fail |
| S5b: same, daemon with `CI=true` (equal environment) | PASS, "Imported: 1 of 1 test file current" | fail |

Why (read in source code). A daemon start keys each test file "from the stored closure list" and treats a hit as safe: "equal contents import the same files" (`src/core/scheduler/bootstrap.ts:34-38`). That premise comes from spec 001 `reviews/wave-1.md` B1. The review quotes research R4: "a closure is a function of its files' contents, resolver config and file existence", and it fixed existence only for unresolved imports, snapshots and declared inputs. A CI import re-keys over this worktree's stored list (`src/core/store/transfer-rekey.ts:96-109`). When the store has no list, the import first stores the exported one (`src/core/store/transfer-rows.ts:94-107`; S5 prints "Added where the store had none: 1 closure lists"). S5a is safe only by accident: the environments differed, so the first lookup missed, and the daemon walked its own closure, which names `new.ts`. The 023 case is the re-review's real-adapter probe (`reviews/wave-1-rereview.md` B1). The live path is right because `stale.ts` re-transforms a module that matches `DYNAMIC_SPECIFIER` on any add (S1).

## 2. Fix A: a listing entry per glob

**Where.** The pattern is always readable from source. Vite accepts only string literals, or arrays of them, and throws `Invalid glob import syntax: Could only use literals` otherwise (`vite/dist/node/chunks/node.js:27567-27576`, Vite 8.3.2; read in source code). It resolves each pattern against the importer, the root, a `base` option, or an alias or `#` subpath through `resolveId` (`toAbsoluteGlob`, `:27732`). It takes the static part as the base directory (`getCommonBase`, `pm.scan`). A template-literal `import()` becomes a glob: `**` is collapsed to `*`, the glob must start with `./` or `../`, and it must name an extension (`dynamicImportToGlob`, `:32563`). S8 shows such an import enters the closure as its matched files, with no listing (verified by experiment).

So the Vitest adapter, which already flags these modules (`src/runners/vitest/dynamic.ts`), resolves each pattern as Vite does. It reports the base directory's listing path, plus `Listings.below` when the remainder of the pattern holds `/` or `**` (`src/core/keys/observed.ts:364-377`). The core records it, as it records observed sets (spec 016 D4; styleguide: a runner writes nothing to the store). The key machinery already exists: a `dir/` entry hashes as the folder's tracked entry names on disk (`observed.ts:446-448`). At a commit, it hashes as the entry names in the commit's tree (`transfer-rekey.ts:170-186`). The 023 lookup and the CI import therefore take a listing with no further change (read in source code).

**Emulation (S6, verified by experiment).** A `src/plugins/` listing was written into the fixture store's shared observed set (`meta` `observed.`). The stored PASS then read `stale`, and one run stored a PASS at the new key. After that:

- A restart with `new.ts` added read `stale`, not PASS.
- A restart with `new.ts` removed again read PASS, reused with no run.
- The second worktree at the commit with `new.ts` read `stale`, not an inherited PASS.

The list stored before the injection gained the listing when it was keyed (S8 shows `src/plugins/` in `a.test.ts`'s list).

**Cost.** Only test files whose closure holds a glob module change their key, and each runs once: 0 files in Squeal and 0 in squawk (question 4). An add or delete of a file in a listed folder that does not match the pattern also re-keys (an over-run, never a miss).

**Key format (inferred from `src/core/keys/key-format.ts:6-15`).** A key with the listing cannot find a result stored under a key without it, so no `KEY_FORMAT_VERSION` raise is needed. The alarm in `test/keys/key-format.test.ts` decides this. Recording location matters here:

- **Only in the adapter's stored closure list.** A list an older release stored has no listing. A start keys from it and keeps the false PASS until the module is walked again. Closing that window would need a `VITEST_ADAPTER_VERSION` raise, which re-keys every Vitest check (about 1,900 Squeal and 1,922 squawk files). The human's rule (2026-10-20) is that a release must not re-key every check unless the meaning changed.
- **In a shared per-project set merged at keying.** This is what S6 emulated. Older lists gain the listing as soon as one new daemon has transformed the module, and no other key moves.

One condition: the observed set applies only while `observe.runtimeInputs` holds (`src/core/scheduler/keying.ts:738-744`, default on). A glob listing must apply either way, so it needs its own set or flag (inferred).

## 3. Fix B, and other inputs that change a closure

**Fix B** marks a key at a commit `not determined (closure)` when a closure module matches `DYNAMIC_SPECIFIER` at either commit. The regex reads raw source, comments and strings included:

- Squeal: 7 modules match, among them `src/core/keys/resolution.ts` (in a comment) and `src/runners/vitest/dynamic.ts` (the regex itself). They sit in 825 of 1,900 test files' closures (43.4%).
- squawk: 4 modules match, in 215 of 1,922 test files (11.2%).
- With a real syntax tree (esbuild, then acorn), the count of real globs is 0 in both repositories. Squeal's one real template import, `test/fixtures/node-test/edge/test/forms.test.ts`, is a declared input of 46 node:test tests (`squeal.config.json`), not a module Vitest loads.

All verified by experiment, `out/modules-*.json`. Fix B also leaves S2 to S5 open. The held 023-03 code shows a second limit: `targetCoverage` returns before any import check when no list file differs (`990b60650:src/core/commit/at-keys-coverage.ts:111-112`), which is the re-review's B1.

**Other resolution inputs** (fixture runs verified by experiment, the rest read in source code):

| Input | Restart or other tree | Live daemon | Fix A | Fix B |
|---|---|---|---|---|
| `package.json` `imports` retargeted to an existing file | PASS, truth `expected 'b' to be 'a'` (S7) | FAIL, caught (S7); `resolution.ts:26-33` | no | no |
| `src/registry.js` added beside the imported `registry.ts`; Vite tries `.js` first | PASS, truth `expected 99 to be 1` (S7) | FAIL, caught (S7); `closuresToReresolve` | no | no |
| tsconfig `paths` | not modelled, "closures are declared incomplete" (`resolution.ts:40-42`) | not handled | no | no |
| `resolve.alias` in the config file or a file it imports | covered: config file and `configFileDependencies` enter the environment hash (`src/runners/vitest/project.ts:22-28`) | covered | not needed | not needed |
| Bare package resolved in `node_modules` | covered by the installed-dependency part | covered | not needed | not needed |

Shadowing adds are rare. 0 of 2,078 Squeal and 0 of 338 squawk first-parent main commits in the last 7 days added or deleted a same-stem twin of a closure module, or an `index` file under an imported directory (`out/adds-*.json`, verified by experiment). A listing for every folder of every closure module would cover shadowing as well, but it would re-key on 16.4% (Squeal) and 52.7% (squawk) of main commits. How often `package.json` resolution fields change was not measured.

## 4. Frequency

| | Squeal (`aaa03f8c8`) | squawk (`8599516b2`) |
|---|---|---|
| Stored closure lists, test files at main | 2,177, 1,900 | 2,573, 1,922 (9 projects) |
| Test files with a regex-matching module | 825 (43.4%) | 215 (11.2%; `server` 14, `e2e` 97, root unit 104) |
| Test files with a real glob or template-import module | 0 | 0 |
| Main commits, 7 days, that add or delete a matching file | 0 of 2,078 | 0 of 338 |
| Commits since 2026-10-01 that touch a real file glob in source | 0 (all hits are tests or comments about globs) | 0 (one `data:` URL template import, `b7c17fed2`, removed in `a1a3de45d`; Vite ignores `data:`) |

## 5. Recommendation for Squeal

1. Take fix A as the single owner of glob membership. The adapter resolves each glob's literal pattern as Vite does. The core records the base folder's listing, recursive where the pattern is, in a shared per-project set that keying always merges, independent of `observe.runtimeInputs`. Restart, other worktrees, CI imports and 023's keys at a commit all get it from the existing `dir/` hashing. Today it re-keys 0 files in either repository, needs no key-format or adapter-version raise, and errs only toward an over-run.
2. Do not ship fix B's regex: it makes 43% and 11% of test files `not determined` with no true positive. If 023-03 must land before fix A, it can guard with a parsed check for a real glob or template import in any closure module, at the commit or here, on every lookup and not only when a list file differs. That check costs 0 test files today.
3. Make a separate row for the other resolution inputs (`package.json` `imports`/`exports`/`main`, shadowing twins, tsconfig `paths`). Their restart false PASS is proven (S7). The cheap form is to put the consulted manifest into the closure, and the shadowing candidates of each resolved relative import. Their frequency on main is low (0 shadowing commits in 7 days), but a restart after a `git pull` hits them.

## Open questions

- Not determined: how often `package.json` resolution fields change on main; not measured.
- Not determined: whether the alias and `#` cases of `toAbsoluteGlob` need the project's resolver at walk time or can reuse Vite's resolved glob. That is a design choice for fix A's row.
- Not determined: the window for a glob module that no daemon of the new release has transformed yet (fix A, recorded in the shared set). It needs one walk per module. Its size depends on users' repositories, and both measured repositories have 0 such modules.

## Sources

- Reviews: `reviews/wave-1.md` B1, `reviews/wave-1-rereview.md` B1; spec 001 `reviews/wave-1.md` B1 (research R4 quote).
- Squeal source at `75e44e78f`: `src/core/scheduler/bootstrap.ts`, `src/core/scheduler/keying.ts`, `src/core/keys/observed.ts`, `src/core/keys/resolution.ts`, `src/core/keys/key-format.ts`, `src/core/store/transfer-rekey.ts`, `src/core/store/transfer-rows.ts`, `src/runners/vitest/dynamic.ts`, `src/runners/vitest/project.ts`, `src/runners/vitest/version.ts`; held 023-03 at `990b60650`: `src/core/commit/at-keys-coverage.ts`.
- Vite 8.3.2, `node_modules/.pnpm/vite@8.3.2_*/node_modules/vite/dist/node/chunks/node.js`: `parseImportGlob` (27542), `toAbsoluteGlob` (27732), `dynamicImportToGlob` (32563).
- Probes: `probes/glob-membership/` (`scenarios.sh` and `out/scenarios.log`, `modules.mjs`, `adds.mjs`, `copy.mjs`).
- Stores: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite` (squawk), read-only table copies.
