# Throwaway probes: key-format-guard (011-35)

**Throwaway.** Nothing here is product code. These scripts exist only to produce the evidence cited in `../../key-format-guard.md`. Delete them freely.

Node v24.21.0. No install in the repository. esbuild 0.28.2 (the lock's version) was installed under `/tmp/kfg-esb` for `bundle.mjs` only.

## Layout

- `raises.sh`: git only. For each `KEY_FORMAT_VERSION` raise, lists the guarded files the forcing window changed (`raises.out`). With `WINDOWS="$(cat tag-windows.txt)"` it does the same for tag-to-tag windows (`tag-windows.out`). The guarded set approximates `test/keys/key-sources.ts` at 0.1.225; manifests are compared without `version` and `devDependencies`.
- `closure.mjs`: reads files through `git show`. Computes the relative-import closure of the key and acceptance entry points at both ends of each window, and lists which changed files fall inside it (`closure.out`; `--types` also follows type-only imports, `closure-types.out`).
- `golden.sh` + `golden.mjs`: one throwaway worktree per release under `/tmp/kfg-golden`, with `HOME` and `XDG_*` there and `KEY_FORMAT_VERSION` patched to 0. Each runs `environmentHash`, `checkKey` and `recordsForFile` (with `describeFailure`) on fixed inputs and prints a hash per output (`golden.out` for tags, `golden-forcing.out` for the forcing-window ends, via `REFS=...`). Node 24 strips the types; `register.mjs` and `resolve-ts.mjs` map relative `.js` imports to `.ts`.
- `bundle.mjs <esbuild-dir> <checkout>...`: bundles the same entry points per checkout with esbuild (tree-shaken, no comments), drops the `KEY_SOURCES_HASHES` table, and hashes the emitted code in three variants: `as-is`, `core-only` and `no-tiers` (`bundle.out`). `KFG_OUT=<dir>` also writes each bundle and its input list.

Run the experiments only while the one-minute load is below the CPU count.
