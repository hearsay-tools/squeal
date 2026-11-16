# glob-membership probes: throwaway

Throwaway scripts for `../../glob-membership.md` (row 023-12). Not product code; do not import them.

They ran on 2026-11-16 between 22:26Z and 22:41Z, at a one-minute load of 19 to 39 on 24 CPUs. No timing is a finding.

Rules kept. Live stores were opened read-only (`readOnly: true`, `PRAGMA query_only`); `copy.mjs` copied `test_files`, `test_file_keys` and `worktrees` into `$TMPDIR` scratch files, which the other scripts read. Git in the real repositories was read with `ls-tree`, `cat-file` and `log` only. The fixture repositories lived under `$TMPDIR/glob-membership/`. Each daemon there ran the Squeal 0.1.527 bundle of this worktree (`plugins/claude-code/dist/cli/squeal.mjs`) with its own `HOME` and XDG folders, wrote only the fixture's store, and was stopped at exit (`trap`). A `/proc` scan after the run found no daemon left. The fixtures and scratch files were deleted. `node_modules/vitest` in each fixture is a symlink to this worktree's Vitest 5.0.3: no install, no network.

| Script | Question | What it does | Output |
|---|---|---|---|
| `scenarios.sh <squeal worktree>` | 1, 2, 3 | S1 to S8 below on one fixture, with `vitest run` as the truth after each | `out/scenarios.log` |
| `copy.mjs <live store> <scratch>` | 4 | copies the closure lists and current keys | `$TMPDIR` only |
| `modules.mjs <scratch> <repo> <ref> <out>` | 3, 4 | test files whose stored closure holds a module that matches `DYNAMIC_SPECIFIER`, and a module with a real `import.meta.glob` call or template-literal `import()` (esbuild strips types, acorn parses) | `out/modules-squeal.json`, `out/modules-cezar.json` |
| `adds.mjs <scratch> <repo> <ref> <since> <out>` | 3, 4 | first-parent main commits since `<since>` that add or delete a file at all, in a directory of a closure module, or as a shadowing twin of a closure module | `out/adds-squeal.json`, `out/adds-cezar.json` |

Scenarios in `scenarios.sh`:

- S1: live add while the daemon runs (control for spec 001 D4 invalidate rule 3).
- S2, S3: add while the daemon is stopped, untracked and committed, then restart.
- S4: a second worktree at the commit with the extra file, first daemon start.
- S5: CI record and export at the commit without the file, import into a fresh clone at the commit with it. S5a with the daemon's `CI` unset, S5b with `CI=true` so the environments are equal.
- S6: fix A emulated. A listing entry `src/plugins/` is written into the fixture store's shared observed set (`meta` key `observed.`), then S2 and S4 are repeated.
- S7: a shadowing `src/registry.js` and a retargeted `package.json` `imports` entry, at restart and live.
- S8: a template-literal `import()`: what its closure holds.

The squawk repository is `~/projects/cezar`; its main was `8599516b2` and Squeal's `aaa03f8c8` when read.
