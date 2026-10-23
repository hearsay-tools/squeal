# Probes for 015-02 complexity and CRAP (throwaway)

Throwaway. Nothing here is product code or a test. Findings: `../../complexity-and-crap.md`.

Every engine loads from a scratch install outside the repository (`DEPS`, default `/tmp/r01502/js/`):

```sh
mkdir -p /tmp/r01502/js && cd /tmp/r01502/js && npm init -y
npm i eslint@10.13.0 typhonjs-escomplex@0.1.0 oxc-parser@0.155.0 tree-sitter-typescript@0.23.2 \
  tree-sitter-javascript@0.25.0 typescript@5 acorn@8 @biomejs/biome@2.6.2 web-tree-sitter@0.27.1
uv venv /tmp/r01502/venv && uv pip install --python /tmp/r01502/venv/bin/python \
  radon==6.0.1 lizard==1.24.2 mccabe==0.7.0 coverage==7.17.0
```

| File | What it does | Output |
| --- | --- | --- |
| `cc-treesitter.mjs` | CC per function over a tree-sitter tree: ESLint `complexity` (classic) rules for TS/JS, radon rules for Python | |
| `cc-estree.mjs` | The same ESLint rules over an ESTree (acorn, oxc-parser) | |
| `engines.mjs` | Loads each engine; one function per engine | |
| `fixtures/constructs.{ts,py}` | One construct per function | |
| `q1-constructs.mjs` | Every counter on the fixtures | `q1-constructs.out.md` |
| `q2-src.mjs <repo> <out.json>` | Every engine over `src/`, agreement with ESLint, time | `q2-src.out.txt` |
| `q2-cold.mjs` | Cold start per engine; TSX grammar against TS grammar | `q2-cold.out.txt` |
| `q5-dist.mjs <repo>` | CC distribution and top 20 over `src/` | `q5-dist.out.md` |
| `q5-crap.mjs <coverage-final.json> <repo>` | Join to a coverage-v8 map, CRAP per function | `q5-crap.out.md` |
| `q5-repeat.py <a.json> <b.json>` | Two coverage runs compared | `q5-repeat.out.json` |
| `q6-history.mjs <repo> <n>` | Replays the last n commits touching `src/*.ts`: identity and threshold transitions (`CC_NAMING=callsite` for the second naming) | `q6-history*.out.json` |
| `q7-python.mjs < files` | tree-sitter against radon and lizard on Python files | `q7-python.out.txt` |

The coverage map came from a `git archive` copy of HEAD at `/tmp/r01502/repo` with `@vitest/coverage-v8@5.0.3` added there, `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` under `/tmp/r01502/home`:
`npx vitest run test/delivery --maxWorkers=4 --coverage.enabled --coverage.provider=v8 --coverage.include=src/core/delivery/** --coverage.reporter=json`.
