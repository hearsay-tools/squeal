# Probes for 015-03 (throwaway)

Throwaway. Nothing here is product code or a test. Read-only on git; no daemon, no store, no agent session, no test run.

- `cc-proxy.mjs`: for each of the last N commits, the `src/` functions whose lines the commit touched (innermost function owning a changed line; a removed line counts against the function that still exists), McCabe CC before and after (1 + `if`, `?:`, `case`, `for`/`for-in`/`for-of`/`while`/`do`, `catch`, `&&`, `||`, `??` and their assignments; nested functions count alone), and the CRAP-30 crossings under a fixed coverage of 0, 50, 80 and 100 % (php-code-coverage's formula). An added function whose body equals one removed in the same commit, or whose bare name matches one, is marked in `identity` (moves and renames). `STANDING=1` prints the CC distribution of every `src/` function in the working tree instead, with the time to parse them.
- `reach.mjs`: the `src/` files a non-e2e test file reaches through relative imports at HEAD (regex, not the TypeScript resolver).
- `*-out.json`: the outputs at `f6f44e030` (2026-10-23). `cc-proxy-out.json` has per-commit rows.

The repository's `typescript` is 7.0.2, whose npm package exports no parser API, so the probe loads TypeScript 5.9.3 from a scratch install: `TS_DIR=/tmp/af-tools node cc-proxy.mjs <repo> 100` (`npm i typescript@5.9` in `/tmp/af-tools`; not in this worktree's `package.json`).

Runs: `cc-proxy.mjs . 100` parsed 156 file versions in 4.9 s (git subprocesses included), load 28.98 on 24 CPUs. `STANDING=1`, five runs: 1,555 to 2,036 ms for 600 files (3.49 MB), load 56 to 58 on 24 CPUs.
