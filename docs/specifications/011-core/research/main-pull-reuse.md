# Why the Cezar main checkout reused about a third of its tests after a pull

Brief: `main-pull-reuse-brief.md`. Researcher, 2026-10-26, about 09:15–09:40 UTC. Squeal 0.1.334
(installed CLI and the main daemon), source read at this worktree (0.1.335, `3ad30a2fe`). Read-only:
store opened with `node:sqlite` `readOnly`, `git diff` between commits, `squeal status` and
`squeal ps` (status reads the store; no daemon is needed).

**Verdict.** No reuse defect was found. At the pull, 370 of 1,073 test files (34%) had a reusable
result. Two causes explain the misses. (1) No worktree ran the final merged content: 22 PRs landed
in this one pull, and 381 files' closures had a combination of content no worktree recorded.
This is required invalidation; the earlier validation was not there. (2) Main's
`node_modules` is from before the pull, but the worktrees installed the new lockfile: 322 files'
closures and config files matched an earlier worktree record, but the installed packages
differ. This is required invalidation by C11's definition, and the cause is outside Squeal.
The "about half" is 370 of the 826 files that were current when status was read (45%), after
main's own checkpoint had run 456 more.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Counts and versions | At the pull (revision 159, 09:08:07 UTC, `e10fcebb0`→`ecdde7685`): 1,073 test files, 370 inherited, 703 with no result. At reading (09:16): 826 current, 247 not current (18 running, 229 queued), 6,890 inherited checks in 370 files, 0 unknown. A `run --all` checkpoint at revision 159 was 456 of 703 done. Main daemon 0.1.334; worktree daemons 0.1.333 and 0.1.334. | verified by experiment (store, status 0.1.334) |
| 2 | Why the misses | 381 (54%): closure content differs from every earlier record. 85 of them are the e2e lane, 273 import `workflows/run.ts`, 42 read ignored build output. 322 (46%): an earlier record has the same closure content and config files, but the installed packages differ (main has the old install). | verified by experiment; install cause partly inferred |
| 3 | Defect, invalidation or missing validation | Required invalidation. The 381 also show missing validation: no worktree ran them at the final content. The 322 are an install difference by definition (C11). No case was found where content and environment both match but keys differ. | read in source code, verified by experiment |

## 1. Counts

Main checkout `/home/agent/projects/cezar`, worktree id `b7555ac0d0f19f40`, branch `main`.
Reflog: `pull: Fast-forward` at 2026-10-26 10:07:49 +0100, `e10fcebb0..ecdde7685`, 22 commits
(#1858 to #1900), 402 files. Revision 159 (trigger `start`, 09:08:07 UTC) is the first revision
after the pull.

Per project at the pull (`classify.mjs`; a file counts as inherited when another worktree has a
result at main's revision-159 key, recorded before 09:08:07):

| project | files | inherited | closure differs | same content, other key |
|---|---|---|---|---|
| server | 582 | 112 | 294 | 176 |
| web | 290 | 208 | 1 | 81 |
| e2e (slow) | 85 | 0 | 85 | 0 |
| root:test:unit | 81 | 24 | 1 | 56 |
| contract | 23 | 23 | 0 | 0 |
| test:unit | 10 | 1 | 0 | 9 |
| api-client | 2 | 2 | 0 | 0 |
| **total** | **1,073** | **370** | **381** | **322** |

The 370 inherited files agree with status's 370 "test files loaded" across 19 source records.
Key format 20 and the Vitest adapter version 3 did not change. The node:test adapter went to 10
in 0.1.333 (`f4011807d`). Main and every worktree daemon that recorded on 2026-10-26 run 0.1.333
or later, so versions explain no miss (read in source code). All daemons run Node v24.21.0
(`/proc/<pid>/exe`).

## 2. The misses

**Closure differs everywhere: 381 files.** For each miss, `classify.mjs` compares main's closure
(`test_files.closure_paths`) with every commit where another worktree recorded a result for that
file, using `git diff --name-only <commit> ecdde7685`. For these files, every recorded commit
differs in at least one closure path:

- 273 non-e2e files include `packages/cezar/src/workflows/run.ts`; for 248 it is the only
  difference. The final `run.ts` came from #1904 (`3d0b0a56b`, merged 08:49 UTC, 18 minutes
  before the pull). Before the pull, results at a commit with that `run.ts` covered 30 + 8 files
  (worktree `94527a48`, commits `3d0b0a56b`, `81c23602b`) and 27 files (`318c88f9`, `7b83fe53f`).
  That worktree ran its 344-file pass from 09:06 to 09:18, after the pull, at `72fe249fc`, where
  `run.ts` differs again. Lookup-only starts and the edit cut (status.md 2026-10-20 and
  2026-10-24) leave the other importers to catch-up. No worktree ran them at the final content.
- 85 e2e files: their declared inputs cover `packages/*/src/**` and the manifests, so every
  merged PR changes them. No worktree recorded them at the final content.
- 42 files (32 e2e, 10 server) read gitignored build output, mostly `packages/cezar/dist/**`.
  Main's `dist` is dated 2026-10-15; every worktree has its own `dist`. All 42 are already in this
  group, so this adds no misses.

**Same content, other key: 322 files.** For these, some worktree recorded a result at a commit
whose closure and config files (`vitest.config.ts`, package manifests, `pnpm-lock.yaml`, setup
files) equal the final commit. Only `packages/{api-client,contract}/tsconfig.json` differ, and
neither is a key input. The keys still differ. The store and the file system show why:

- Main's `node_modules/.pnpm/lock.yaml` has hash `0c5cc105` and mtime 2026-10-25 23:54, from the
  install after the previous pull. It has no `@stryker-mutator/core` and no `@babel/core@8`.
  `ecdde7685:pnpm-lock.yaml` has both; #1893 (`ab603e66f`) added them, and three other PRs in this
  pull also changed the lockfile. Six worktrees on 2026-10-26 have install `fb667540` with these
  packages (installed 07:48 to 09:48 +0100).
- `file_hashes` for main and worktrees `60abf13b`/`94527a48`: `vitest.config.ts`, every
  `packages/*/vitest.config.ts`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` and
  `squeal.config.json` hash the same. Only `node_modules/.pnpm/lock.yaml` differs (and `94527a48`'s
  `packages/cezar/vitest.setup.ts`).
- `peers.mjs` against `60abf13b` (install `fb667540`), counting only test files whose every
  closure path is hashed in both worktrees: 24 have equal hashes and equal keys, and 62 have equal
  hashes but different keys. All 62 are node:test files (53 `root:test:unit`, 9 `test:unit`).
  Those key by the whole install fingerprint (C11 case 5). Vitest files with equal hashes keep
  their key. The looser count, which treats a path missing from both stat caches as equal, gives
  361 equal and 547 different (402 server, 82 web). `file_hashes` holds only the paths each daemon
  hashed, so that count is weaker evidence.
- C11 (spec, "Installed dependencies") keys by what is installed under `node_modules`; a committed
  `pnpm-lock.yaml` is not an install. `stalePnpmLockfile` (`src/core/keys/pnpm-install.ts:116`)
  checks `lock.yaml` against the virtual store, not against `pnpm-lock.yaml`.
  `awaiting-install.b7555ac0d0f19f40` is `false`, because an install exists.

So main's tests run against the old packages, and the worktrees' results were made against the
new ones. Not matching them is correct. Inferred limit: 252 of the 322 best records are `dirty=1`,
so their exact files are not known from the commit. The removed worktrees (`2f15adc6`, `318c88f9`,
and others) no longer have a `node_modules` to read. The install difference is proven for the
live worktrees and inferred for the removed ones.

## 3. Classification

- **Reuse defect:** none found. In the strict `peers.mjs` comparison, every file with equal
  closure hashes and different keys is a node:test file, which keys by the install. The worktrees
  with main's install (`0c5cc105`) are at commits before #1891 (`768420524`), so their root
  `vitest.config.ts`, an environment input, differs from the final one.
- **Required invalidation:** all 703 misses. Content (381) or installed packages (322) differ.
- **Missing validation:** the 381 closure misses. The worktrees of the last PRs ran only their
  edit tier at the final content before merge. No checkout ran the combined result before the
  pull. Main's `run --all` is doing that now.

## Recommendation for Squeal

No key change. Two things are worth a coordinator's decision:
(a) after a pull that changes `pnpm-lock.yaml`, Squeal could say that `node_modules` is older than
the committed lockfile, because then results from worktrees with a fresh install cannot apply. In
this pull, that was 46% of the misses. Note that C11 deliberately does not treat the committed
lockfile as an install.
(b) a pull that merges many PRs cannot inherit what no worktree ran. Only a run at the merged
content (main's own checkpoint, or CI) covers it.

## Open questions

- The exact content behind the 252 dirty best records is not determined, because the store keeps
  commits, not working-tree content, and those worktrees are removed.
- What the human read as "about half" is inferred: 370 of 826 current (45%) at 09:16, and 6,890 of
  16,494 passed checks (42%).
- The ignored `dist` reads (42 files) may need a declared build input or an exclusion. They added
  no miss here.

## Sources

- Store: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (tables `revisions`,
  `test_file_keys`, `test_files`, `results`, `file_hashes`, `meta`), read 09:15–09:40 UTC.
- `squeal status --full`, `--notes`, `squeal ps --repo` (0.1.334), run in `/home/agent/projects/cezar`.
- Git: `/home/agent/projects/cezar` reflog, `git log e10fcebb0..ecdde7685`, `git show
  <c>:pnpm-lock.yaml`; `node_modules/.pnpm/lock.yaml` of main and `.ai/cezar/worktrees/*`.
- Source: `src/core/keys/check-key.ts`, `environment.ts`, `dependencies.ts`, `pnpm-install.ts`,
  `src/runners/node-test/version.ts`; spec 011 C1, C3, C7, C11; `status.md` 2026-10-20, 2026-10-23,
  2026-10-24.
- Probes: `research/probes/main-pull-reuse/` (`q.mjs`, `classify.mjs`, `peers.mjs`, `case.mjs`).
