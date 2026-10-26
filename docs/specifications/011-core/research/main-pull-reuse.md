# Why the Cezar main checkout reused about a third of its tests after a pull

Brief: `main-pull-reuse-brief.md`. Researcher, 2026-10-26, about 09:10–09:22 UTC; status read at
about 09:13 UTC. Squeal 0.1.334 (installed CLI and the main daemon), source read at this worktree
(0.1.335, `3ad30a2fe`). Read-only: store opened with `node:sqlite` `readOnly`, `git diff` between
commits, `squeal status` and `squeal ps` (status reads the store; no daemon is needed).

**Verdict.** No reuse defect was found. That does not prove that all 703 misses were correct. At
the pull, 370 of 1,073 test files (34%) had a result at main's key, and 703 had none. This is
exact store evidence. For the 703, the evidence is a comparison of committed content, and a
result recorded in a dirty worktree may have had other bytes than its commit. On that basis:
381 files differ in their closure from every commit that recorded a result for them, so most
likely no worktree ran the final merged content (22 PRs in one pull). 322 files have a recorded
commit with the same closure and config files. For those, the one live difference found is the
install: main's `node_modules` is from before the pull, and six live worktrees have the new
lockfile installed. That the install is the cause is directly verified only in live worktrees,
not for the removed worktrees that made most of the 322 best records (252 of them dirty). The
"about half" is probably 370 of the 826 files current at about 09:13 (45%), after main's own
checkpoint had run 456 more.

## Evidence levels

| Level | What it shows | Count | Tag |
|---|---|---|---|
| Exact store key | Files with a result at main's revision-159 key, recorded by another worktree before 09:08:07 UTC | 370 hit, 703 miss, of 1,073 | verified by experiment |
| Committed content | Misses whose closure differs from every commit with a recorded result for that file | 381 (85 e2e, 296 others) | verified by experiment, at commit level only |
| Committed content | Misses with a recorded commit whose closure and config files equal `ecdde7685` | 322; best record clean (`dirty=0`) 70, dirty 252 | verified by experiment, at commit level only |
| Live install | Main's installed lockfile differs from six live worktrees that have the final `pnpm-lock.yaml` installed | `0c5cc105` vs `fb667540` | verified by experiment |
| Live install | Test files with equal closure hashes in main and live worktree `60abf13b` but different current keys | 62, all node:test (keyed by the whole install) | verified by experiment; not crossed with the 322 |
| Uncertain | Actual bytes behind dirty records; installs of removed worktrees; why the 70 clean records' keys differ | not determined | — |

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Counts and versions | At the pull (revision 159, 09:08:07 UTC, `e10fcebb0`→`ecdde7685`): 1,073 test files, 370 inherited, 703 with no result. At about 09:13: 826 current, 247 not current (18 running, 229 queued), 6,890 inherited checks in 370 files, 0 unknown. A `run --all` checkpoint at revision 159 was 456 of 703 done. Main daemon 0.1.334; worktree daemons 0.1.333 and 0.1.334. | verified by experiment (store, status 0.1.334) |
| 2 | Why the misses | By committed content: 381 differ in their closure from every recorded commit (85 e2e; 273 import `workflows/run.ts`; 42 read ignored build output). 322 match a recorded commit in closure and config files; the only live difference found is main's older install. Dirty records limit both groups. | verified at commit level; install cause verified live, inferred for removed worktrees |
| 3 | Defect, invalidation or missing validation | No reuse defect found. The evidence fits required invalidation (content or install differ) and missing validation of the merged content. It does not prove every one of the 703 misses correct. | read in source code, verified by experiment, inferred |

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

**Closure differs from every recorded commit: 381 files.** For each miss, `classify.mjs` compares main's closure
(`test_files.closure_paths`) with every commit where another worktree recorded a result for that
file, using `git diff --name-only <commit> ecdde7685`. For these files, every recorded commit
differs in at least one closure path. This compares commits; a dirty worktree's actual bytes may
differ from its commit, and I did not count how many of these records were dirty:

- 273 non-e2e files include `packages/cezar/src/workflows/run.ts`; for 248 it is the only
  difference. The final `run.ts` came from #1904 (`3d0b0a56b`, merged 08:49 UTC, 18 minutes
  before the pull). Before the pull, results at a commit with that `run.ts` covered 30 + 8 files
  (worktree `94527a48`, commits `3d0b0a56b`, `81c23602b`) and 27 files (`318c88f9`, `7b83fe53f`).
  That worktree recorded 344 files at `72fe249fc` from 09:06 to 09:18, mostly after the pull,
  and that commit has another `run.ts`. Lookup-only starts and the edit cut (status.md 2026-10-20
  and 2026-10-24) leave the other importers to catch-up. No recorded commit had their final
  content; whether a dirty worktree had those bytes is not determined.
- 85 e2e files: their declared inputs cover `packages/*/src/**` and the manifests, so every
  merged PR changes them. No recorded commit had their final content.
- 42 files (32 e2e, 10 server) read gitignored build output, mostly `packages/cezar/dist/**`.
  Main's `dist` is dated 2026-10-15; every worktree has its own `dist`. All 42 are already in this
  group, so this adds no misses.

**Same committed content, other key: 322 files.** For these, some worktree recorded a result at a commit
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

So main's tests run against the old packages. The live worktrees with the final lockfile have
the new ones, and a key that differs for that reason is correct by C11. Limits: 252 of the 322
best records are `dirty=1`, so their actual bytes are not known from the commit. Many best
records come from removed worktrees (`2f15adc6` 115, `318c88f9` 24, and others) that have
no `node_modules` left to read. The 62 live node:test files were not crossed with the 322. For
the 70 clean best records the tracked files equal the commit, so their key difference comes from
something outside it (install, ignored or untracked files, environment variables); which one is
not determined. The install difference is verified for the live worktrees and inferred for the
removed ones.

## 3. Classification

- **Reuse defect:** none found. In the strict live `peers.mjs` comparison, every file with equal
  closure hashes and different keys is a node:test file, which keys by the install. The worktrees
  with main's install (`0c5cc105`) are at commits before #1891 (`768420524`), so their root
  `vitest.config.ts`, an environment input, differs from the final one. This rules out a defect
  only where live evidence exists; it does not prove all 703 misses correct.
- **Required invalidation, at commit level:** 381 files differ in content from every recorded
  commit. 322 match a recorded commit, and the one difference found live is the install.
- **Missing validation, at commit level:** the 381. The worktrees of the last PRs ran only their
  edit tier at the final content before merge. No recorded commit before the pull had the
  combined result. Main's `run --all` is running it now.
- **Not determined:** the actual bytes of dirty records, the installs of removed worktrees, and
  the cause for the 70 clean best records.

## Recommendation for Squeal

No key change. Two things are worth a coordinator's decision:
(a) after a pull that changes `pnpm-lock.yaml`, Squeal could say that `node_modules` is older than
the committed lockfile, because then results from worktrees with a fresh install cannot apply. In
this pull, up to 322 of the 703 misses (46%) fit that case. Note that C11 deliberately does not treat the committed
lockfile as an install.
(b) a pull that merges many PRs cannot inherit what no worktree ran. Only a run at the merged
content (main's own checkpoint, or CI) covers it.

## Open questions

- The actual bytes behind dirty records (252 of the 322 best records; not counted for the 381)
  are not determined, because the store keeps commits, not working-tree content, and those
  worktrees are removed.
- The installs of removed worktrees, and the key difference for the 70 clean best records, are
  not determined.
- What the human read as "about half" is inferred: 370 of 826 current (45%) at about 09:13, and 6,890 of
  16,494 passed checks (42%).
- The ignored `dist` reads (42 files) may need a declared build input or an exclusion. They added
  no miss here.

## Sources

- Store: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (tables `revisions`,
  `test_file_keys`, `test_files`, `results`, `file_hashes`, `meta`), read about 09:10–09:22 UTC.
- `squeal status --full`, `--notes`, `squeal ps --repo` (0.1.334), run in `/home/agent/projects/cezar`.
- Git: `/home/agent/projects/cezar` reflog, `git log e10fcebb0..ecdde7685`, `git show
  <c>:pnpm-lock.yaml`; `node_modules/.pnpm/lock.yaml` of main and `.ai/cezar/worktrees/*`.
- Source: `src/core/keys/check-key.ts`, `environment.ts`, `dependencies.ts`, `pnpm-install.ts`,
  `src/runners/node-test/version.ts`; spec 011 C1, C3, C7, C11; `status.md` 2026-10-20, 2026-10-23,
  2026-10-24.
- Probes: `research/probes/main-pull-reuse/` (`q.mjs`, `classify.mjs`, `peers.mjs`, `case.mjs`).
