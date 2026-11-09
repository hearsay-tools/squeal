# Probes for quality-gate.md (row 015-126)

Throwaway. Not product code, not tests. Kept only as the evidence of
`../../quality-gate.md`. Run 2026-11-09 at Squeal `fc58af3da` (0.1.422),
Node v24.22.1, Vitest 5.0.3, tsx from this repository's lockfile.

Every run used a scratch clone at `/tmp/qg/repo` (`git clone --shared`, with
`node_modules` a symlink to this worktree's), and `HOME`, `XDG_RUNTIME_DIR`,
`XDG_CONFIG_HOME` and `TMPDIR` under `/tmp/qg`. No daemon, no store, no agent
session. cezar was read with `git show`, `git diff`, `git ls-tree`,
`git cat-file` and `git grep` only, at `7b726e2a2`. `/tmp/qg` was deleted
afterwards.

| File | What it does | Output |
|---|---|---|
| `one-shot.mts` | Q1: Squeal's Vitest adapter with Squeal's provider, `mapHere`, `countFile`, `joinCoverage`, `crapScore`, in one process | `oneshot-round1.out.json`, `oneshot-test-callbacks.out.json` |
| `timing.sh`, `sample.txt` | Q1: 5 rounds of plain Vitest, `squeal ci record` (committed bundle) and `one-shot.mts` on 30 test files, rotating order, load logged | `timing.out.tsv` |
| `changed.mts` | Q3, Q4: changed functions of a commit range by D2 identity and body hash | `cezar-changed.out.json` (last 10 first-parent commits of cezar main), `squeal-changed.out.json` (last 30 of Squeal main) |
| `count-all.mts` | Q3: every JS/TS file at a commit, test files apart | `count-squeal.out.json`, `count-cezar.out.json` |
| `cases.mts` | Q5: #167's collection cases on fixture repositories | `cases.out.json` |
| `child.mts` | Q4, Q5: child-process coverage through `NODE_V8_COVERAGE` and `ownRecord`, a truncated child file, visibility | `child-cut0.out.json`, `child-cut1.out.json` |

Commands, from `/tmp/qg/repo` with the variables above:

```sh
P=<this directory>
P=$P $P/timing.sh
node_modules/.bin/tsx $P/changed.mts /tmp/qg/repo ~/projects/cezar out.json <base>..<head>...
node_modules/.bin/tsx $P/count-all.mts /tmp/qg/repo <repo> <rev> out.json
node_modules/.bin/tsx $P/cases.mts /tmp/qg/repo /tmp/qg <worktree>/node_modules out.json
CUT_INDEX=0 node_modules/.bin/tsx $P/child.mts /tmp/qg/repo /tmp/qg <worktree>/node_modules out.json
```
