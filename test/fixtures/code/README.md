# Code counter fixtures (spec 015 D3, row 015-05)

The counter's tests (`test/code/count/`) compare `countFile` with counts that ESLint's and radon's own code made. Nothing here is product code.

| File | What it is |
| --- | --- |
| `constructs.ts`, `constructs.py` | One construct per function, from the research (`docs/specifications/015-coverage-complexity/research/probes/complexity-and-crap/fixtures/`), then the edges 015-05 added. |
| `view.tsx`, `plain.cjs` | JSX through the TSX grammar; plain CommonJS. |
| `constructs.eslint.json` | ESLint's counts for the three JS and TS fixtures. |
| `constructs.radon.json` | radon's counts for `constructs.py`. |
| `src.eslint.json` | ESLint's counts for every JS and TS file under `src/` at `commit`. |
| `py.radon.json` | radon's counts for every `.py` file of the repository at `commit`. |
| `reference/eslint-counts.cjs` | Makes an ESLint file: per file, `[endLine, endColumn, cc]` of each function. |
| `reference/radon_counts.py` | Makes a radon file: per file, `[startLine, startColumn, cc]` of each function. |

Positions are 1-based and the end is just after the last character, as `CodeRange`. ESLint's counts are keyed by a function's end, because ESLint places an arrow function at its `=>`; radon's by the `def`. ESLint's class field initializers and static blocks are left out: they are code paths of their own, not functions. radon reports no method of a class nested in a function or a class; the counter does.

ESLint is 10.13.0 with `@typescript-eslint/parser` 8.72.0, so that TypeScript is read as written (the research stripped types, which fails on parameter properties). radon is 6.0.1.

To make them again, outside the repository:

```sh
mkdir -p /tmp/cc/js && cd /tmp/cc/js && npm init -y && npm i --ignore-scripts eslint@10.13.0 @typescript-eslint/parser@8.72.0 typescript@5
uv venv /tmp/cc/venv && uv pip install --python /tmp/cc/venv/bin/python radon==6.0.1
PIN=e90e0030ccfef2ee90eabe9db3046c398ebdd3e5   # squeal--v0.1.279, on main
mkdir -p /tmp/cc/pin && git -C <repo> archive $PIN | tar -x -C /tmp/cc/pin
cd <repo>/test/fixtures/code
DEPS=/tmp/cc/js node reference/eslint-counts.cjs . constructs.eslint.json constructs.ts view.tsx plain.cjs
/tmp/cc/venv/bin/python -I reference/radon_counts.py . constructs.radon.json constructs.py
git -C <repo> ls-tree -r --name-only $PIN src | grep -E '\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$' \
  | COMMIT=$PIN DEPS=/tmp/cc/js node reference/eslint-counts.cjs /tmp/cc/pin src.eslint.json
git -C <repo> ls-tree -r --name-only $PIN | grep -E '\.py$' \
  | COMMIT=$PIN /tmp/cc/venv/bin/python -I reference/radon_counts.py /tmp/cc/pin py.radon.json
```

`COMMIT` is the commit `test/code/count/corpus.test.ts` reads the sources at.
