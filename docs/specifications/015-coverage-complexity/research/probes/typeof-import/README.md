# Probes for 015-25 `typeof import` in a type argument (throwaway)

Throwaway. Nothing here is product code or a test. Findings: `../../typeof-import.md`.

Scratch, all under `/tmp/tir-015-25` (not in git): read-only clones of cezar at `cf9df51a9` (its `origin/main`, 2026-10-24) and `03c905a00`, of squeal at `55afb856a` and `d5018817a`; tree-sitter-typescript cloned from GitHub (`v0.23.2` = `f975a62`, master = `75b3874`, pull request 375 = `2890bf7`); `eslint@10.13.0`, `@typescript-eslint/parser@8.72.0` in `js/`; `tree-sitter-cli@0.27.1` in `cli/`, run with `HOME` and `XDG_CACHE_HOME` under `/tmp/tir-015-25/home`. Both grammars built there with `tree-sitter build --wasm -o <out> .` from `tsx/` (`g-0232.wasm`, `g-pr375.wasm`).

| File | What it does | Output |
| --- | --- | --- |
| `tree.mjs <snippets>` | The tree of each snippet, split by `// ---` lines; `WASM=<file>` loads another grammar | `snippets.out.txt` (shipped), `snippets.pr375.out.txt` |
| `snippets.ts` | The constructs, the PR's cases and the rewrite candidates | |
| `measure.mjs <repo> <out.json>` | Every JS/TS file counted shipped, with rewrites r1 to r3, and over the PR 375 grammar; each against ESLint `complexity`; the PR's tree and a same-toolchain 0.23.2 build compared with the shipped tree | `/tmp` JSON |
| `analyze.mjs <out.json> --list` | The tables, per file set | `out-<checkout>.md` |
| `cost.mjs <repo>...` | Parse and walk of every file without and with r2, five alternated pairs, load beside each | `cost.out.txt` |
| `count-0.1.284.mjs <counter> <repo> <exclude>` | Parse errors and functions in them, test-named files apart, with the released 0.1.284 counter or this one | `count-0.1.284.out.txt` |
| `errors.mjs <file>` | The root's children and the first `ERROR` and `MISSING` nodes | `errors-composer.out.txt` |

Run every `.mjs` that imports the counter with `node_modules/.bin/tsx` from the worktree root. "Test-named" is `*.test.*`, `*.spec.*`, `*.e2e.ts`: a stand-in for the files the runners list, which `squeal code` never counts.
