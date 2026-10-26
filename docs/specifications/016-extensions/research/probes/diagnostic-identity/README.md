# Probe: diagnostic-identity (016-33)

**Throwaway.** Evidence for `../../diagnostic-identity.md`, not product code. Nothing here runs in the suite. The tools were installed in the scratch directory `/tmp/diag-identity-016-33`, never in the worktree; no `node_modules` is in git.

## What it shows

1. `states.mjs` writes eight states (`s0` to `s7`) of a two-file fixture in TypeScript, JavaScript and Python. Each state is one edit of the state before it. Every language has the same three findings: an unused local `count` (the message names it), a call to the undefined name `report`, and a call to the undefined name `notify` in function `beta`.
   - s1 inserts a comment line at the top; s2 renames `count` to `tally`; s3 adds a second, identical `report(1)` line in `gamma`; s4 removes the first `report(1)` (in `alpha`); s5 moves `beta` to `b`; s6 removes `notify(2)`, the last finding of `b`; s7 changes only the type of `limit` in `b` (added beyond the brief, for Q4).
2. `run.sh <scratch> out` runs, on each state, `tsc --noEmit --pretty false -p .` (`config/tsconfig.json`), `eslint -f json` and the `@microsoft/eslint-formatter-sarif` formatter (`config/eslint.config.js`, core rules only), and `ruff check --output-format json|gitlab|sarif` (`config/ruff.toml`). Raw output is in `out/ts`, `out/js`, `out/py`; versions in `out/versions.txt`.
3. `compare.mjs <scratch>/states out` applies each candidate check unit to the recorded output and prints the notices per edit, judged against the experimenter's label of each finding (its enclosing function and kind). Output: `out/compare.txt`.
4. `typed.sh <scratch>/typed out/typed-eslint.txt` runs one typed ESLint rule (`@typescript-eslint/no-floating-promises`) on an unchanged `a.ts` while only `b.ts` changes (Q4). This scratch install is separate: typescript-eslint 8.72.0 brought TypeScript 6.0.3.

## Re-run

```sh
S=/tmp/diag-identity-016-33
mkdir -p $S && cd $S && npm init -y && npm install typescript@7.0.2 eslint@10.13.0 @eslint/js @microsoft/eslint-formatter-sarif
uv venv .venv && uv pip install --python .venv/bin/python ruff==0.17.2
mkdir typed && cd typed && npm init -y && npm install eslint@10.13.0 typescript-eslint@8.72.0
cd <this dir> && ./run.sh $S out && node compare.mjs $S/states out > out/compare.txt && ./typed.sh $S/typed out/typed-eslint.txt
```

Absolute paths in `out/` name the scratch directory.
