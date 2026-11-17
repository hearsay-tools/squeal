# environment-at-commit probes: throwaway

Throwaway scripts for `../../environment-at-commit.md` (row 023-02). Not product code; do not import them.

They ran on 2026-11-16 between 15:43Z and 16:09Z, at a one-minute load of 12 to 34 on 24 CPUs. No timing is a finding.

Rules kept: live stores are opened read-only (`readOnly: true`, `PRAGMA query_only`), and `copy.mjs` copies the small tables into `$TMPDIR/eac/*.sqlite`, which the other scripts read. Git in the real repositories is read with `log`, `ls-tree`, `show`, `cat-file` and `rev-parse` only. The three scratch checkouts (`x1`, `x2`, `c1`) were `git clone --shared --no-checkout` copies under `$TMPDIR/eac/`, installed with `pnpm install --frozen-lockfile --prefer-offline`. In each, a Squeal 0.1.523 daemon (`~/.claude/plugins/cache/hearsay/squeal/0.1.523/dist/cli/squeal.mjs start`) wrote only that clone's own store and ran no test (`baseline.onStart: lookup-only`). Each daemon was stopped with `squeal stop --until-start`, checked gone in `ps`, and the clones were deleted.

| Script | Question | What it does | Output |
|---|---|---|---|
| `copy.mjs <live store> <scratch>` | all | copies `worktrees`, `revisions`, `environments`, `worktree_environment_hashes`, `test_file_keys`, `imports`, import environments and clean result labels | `$TMPDIR` only |
| `parts.mjs <scratch>` | 1 | which descriptor parts differ between consecutive hashes per project | `out/parts-*.json` |
| `config-only.mjs <scratch>` | 1 | hashes whose git-held inputs are equal but whose resolved config differs | `out/config-only-*.json` |
| `installed-from-git.mjs <repo> <commit> [<lock.yaml>]` | 1, 3 | the installed-dependency part computed from the committed `pnpm-lock.yaml` | `out/installed-from-git-squeal.jsonl` |
| `installed-match.mjs <repo> <scratch> <since>` | 1 | recorded installed parts that equal a committed lockfile's computed value | `out/installed-match-*.json` |
| `share.mjs <repo> <scratch> <tip> 7 <asker root>` | 2, 5 | per main commit and project: not determined against the asker, and which approach recovers it | `out/share-*.json` |
| `by-age.mjs <share.json> <rows>` | 2, 5 | the same by commit age | `out/by-age-*.json` |
| `record-size.mjs <scratch> 7 <dir>` | 2 | rows and bytes of a `(commit, project) -> hash` table; size of `environments` | `out/record-size-*.json` |
| `compare-install.mjs <clone store> <scratch> <root>` | 3 | scratch-install hashes against a live worktree at the same commit, part by part | `out/compare-install-cezar.json` |
| (inline query, see the file) | 3 | scratch hashes looked up among live-recorded hashes | `out/scratch-hashes-in-live-cezar.json`, `out/scratch-hashes-squeal.txt` |
| (inline query on `share.mjs` rows, see the file) | 5 | single-hash lookups in projects with a config-only difference | `out/flagged-single-cezar.json` |
| `stale-installs.mjs <scratch>` | 3 | live worktrees whose installed part differs from their `HEAD`'s lockfile | `out/stale-installs-*.json` |
| `node-pairs.mjs <scratch>` | 4 | hashes equal in every part except Node | `out/node-pairs-*.json` |

`installed-from-git.mjs`, `installed-match.mjs`, `share.mjs` and `stale-installs.mjs` re-implement, for the probe only, the whole-fingerprint branch of `installedDependencies` (`src/core/keys/environment.ts`) and `withoutLinkedSpecifiers` (`src/core/keys/pnpm-lockfile.ts`) at `c13564931`.

`share.mjs` writes its per-commit rows to stderr; they were kept in `$TMPDIR/eac/share-*-rows.jsonl` for `by-age.mjs` and the flagged-project count, and are not committed.
