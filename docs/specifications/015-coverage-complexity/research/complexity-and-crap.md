# 015-02: complexity and CRAP

Brief: `complexity-and-crap-brief.md`. Researcher, 2026-10-23. Evidence: tool sources read at the versions named, a fixture with one construct per function, every engine run over this repository's `src/` at `f6f44e03` (605 JS/TS files, 3.5 MB), a coverage-v8 map of `src/core/delivery/` from its own 34 test files in a `/tmp` copy, and a replay of the last 300 commits that touch `src/*.ts` (2026-10-20 to 2026-10-23). Host load was 28 to 62 during the timings. Probes and outputs: `probes/complexity-and-crap/`. Added during the work (coordinator, 2026-10-23): test the reading that "the code can squeal", complexity and CRAP as a check type with a state per function. Section 8 answers it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Counting | ESLint counts `if`, loops, `case` with a test, `catch`, ternary, `&&` `||` `??`, `?.`, defaults and logical assignment. radon is the Python equivalent. typhonjs-escomplex (2018), lizard and mccabe each miss or add constructs. Biome has cognitive complexity only. | read in source code, verified by experiment |
| 2 | Engines | web-tree-sitter, which Squeal already ships, plus the TSX grammar. Counts equal ESLint on 481 of 481 files. 2.2 to 3.7 ms per file, +1.45 MB per plugin. acorn adds 0 B but fails on 5 of 605 files. oxc is native. TypeScript 7 has no JS AST API. | verified by experiment |
| 3 | CRAP | `CC² × (1 − cov)³ + CC`, threshold 30. The formula names basis-path coverage. PHPUnit uses path coverage, else lines. JS peers use statement or min(statement, branch) coverage. | read in official docs, read in source code |
| 4 | Join | By position, never by name. 384 of 385 functions match on body start. coverage.py's JSON keeps one entry per qualified name. | verified by experiment |
| 5 | Experiment | 7,072 functions: median 2, p90 7, p99 19, max 76. CRAP over delivery: 10 of 384 functions at 30 or more. About half of the top 20 are risky by reading. | verified by experiment |
| 6 | Identity | CC is a pure function of the blob plus the counter version. A qualified name kept 96% of functions in edited files. 38% are anonymous, and 1.1% share a name. | verified by experiment, inferred |
| 7 | Python | tree-sitter with radon's rules equals radon on 2,064 of 2,064 functions. coverage.py 7.6+ reports per function by qualified name, but drops duplicates. | verified by experiment |

## 1. What each tool counts

Each function starts at 1. The table shows how much one construct adds. Fixture: `fixtures/constructs.ts` and `constructs.py`. Output: `q1-constructs.out.md`.

| Construct | ESLint 10.13.0 `complexity` | typhonjs-escomplex 0.1.0 | lizard 1.24.2 (TS) | Biome 2.6.2 |
|---|---|---|---|---|
| `if`, `else if`, `for`, `while`, `do`, ternary, `&&`, `\|\|` | +1 each | +1 each | +1 each | cognitive only |
| `for…of`, `for…in` | +1 | 0 (option `forin`, off) | +1 | |
| `case` with a test, `default` | +1, 0 | +1, 0 | +1, 0 | |
| `catch`, `finally` | +1, 0 | 0 (option `trycatch`, off), 0 | +1, 0 | |
| `??`, `?.` member and call | +1 each | 0 | `??` +1, `?.` 0 | |
| default parameter, destructuring default, `??=` | +1 each | 0 | +1 | |
| conditional type `T extends U ? X : Y` | 0 | 0 | lost the function | |

ESLint also has `variant: "modified"`, which counts a whole `switch` as 1. Its "class field initializer" is a code path of its own (`lib/rules/complexity.js`). typhonjs-escomplex's last release is 0.1.0 from 2018-12-21. It parses `??` and `?.` but counts neither. lizard is token-based. It drops one-line Python `def`s and loses a function after a conditional type.

| Python construct | radon 6.0.1 | mccabe 0.7.0 | lizard 1.24.2 |
|---|---|---|---|
| `if`, `elif`, `while`, `for` | +1 | +1 | +1 |
| loop `else`; `try … else` | +1; +1 | +1; 0 | 0; 0 |
| each `except`; `finally` | +1; 0 | +1 (two excepts: 4); +1 | +1; +1 |
| `and` or `or` (per extra operand); `x if c else y` | +1; +1 | 0; 0 | +1; +1 |
| comprehension `for` and `if`; `assert` | +1 each; +1 | 0; 0 | +1 each; 0 |
| `match`: each `case` except `case _` | +1 | 0 | +1, `_` too |
| nested function | separate | added to the outer | separate |

radon's `visit_Assert` does not descend, so an `and` inside an `assert` adds nothing. A `case … if` guard adds nothing. mccabe builds a graph of statements and ignores expressions.

**Cognitive complexity.** SonarSource's paper (G. Ann Campbell, version 1.7, 2023-08-29) says cyclomatic complexity "accurately calculates the minimum number of test cases required to fully cover a method". It does not measure understandability. Cognitive complexity ignores `?.` and null-coalescing, counts a `switch` once, counts a sequence of like boolean operators once, and adds weight for nesting. Biome implements only that: `noExcessiveCognitiveComplexity`, default 15, its source given as "sonarjs/cognitive-complexity" (docs page). Biome chose it to measure readability. CRAP asks about testability, and the paper itself says cyclomatic complexity answers that.

## 2. Engines

Every engine counted by ESLint's classic rules (`cc-treesitter.mjs`, `cc-estree.mjs`). Over `src/` (`q2-src.out.txt`), each engine's counts per file, compared as a multiset, equal ESLint's on 481 of 481 files with functions. Five more files ESLint could not read (below). Matching on line alone shows 16 false differences: ESLint places an arrow function at its `=>`.

| Engine | ms per file, warm (load ~30 / ~55) | Cold: load and first parse | Bytes added per plugin | Limits |
|---|---|---|---|---|
| web-tree-sitter 0.27.1 + tree-sitter-tsx 0.23.2 | 2.2 / 3.7 | 30 to 50 ms init and grammar, 37 to 94 ms first parse | 1,445,638 (runtime and Python grammar already shipped) | Grammar 0.23.2 is the newest on npm. It marks `export type * from` (TS 5.0) as an error node, and counts stay right. Its `?.` in a call is a bare token, where the JS grammar 0.25.0 has an `optional_chain` node. Both must count. |
| acorn 8.19 after `stripTypeScriptTypes` (Node 24) | 0.64 / 1.3 | ~110 ms first strip and parse | 0 (already bundled) | Strip mode throws on parameter properties: 5 of 605 files here. No JSX. The API is experimental. |
| oxc-parser 0.155.0 | 0.67 / 1.8 | ~12 ms load, 1 to 3 ms first parse | Native `.node` 2.1 MB per platform (19 platforms), or a wasm32-wasi binding 1.67 MB plus the emnapi runtime | A platform-neutral committed bundle cannot hold the native binding. The wasm binding was not tried. |
| TypeScript compiler API 5.9.3 (parse only) | 0.55 / 1.2 | not measured | 9,112,572 | The project's TypeScript 7.0.2 exports only `unstable/*`, with no `createSourceFile`. |
| ESLint 10.13.0 (reference) | 3.9 / 8.6 | | | Needs a TS parser. Here it read stripped JS. |

The TSX grammar parsed all 605 `src/` files, `.ts` and `.js` included, to the same counts as the TypeScript grammar (`q2-cold.out.txt`). One grammar can serve both. Its known limit is `<T>x` type assertions in `.ts` files. Each plugin then carries +1.45 MB, against +3.27 MB for the TS, TSX and JS grammars together.

## 3. CRAP

Savoia, Artima, 2007-07 ("This Code Is C.R.A.P.") and 2007-10 (crap4j release post): `CRAP(m) = comp(m)^2 * (1 – cov(m)/100)^3 + comp(m)`. comp is cyclomatic complexity, "one plus the number of unique decisions". cov is test coverage, and the post adds "For code coverage we use basis path coverage". The threshold is 30 ("INITIALLY"). By its table, CC 10 needs 42% coverage, CC 25 needs 80%, and from CC 31 "no amount of testing" stays below. A project is crappy above 5% crappy methods. (read in official docs)

| Implementation | Coverage it uses | Notes |
|---|---|---|
| PHPUnit php-code-coverage 14.4.1, `Node/CrapIndex.php`, `Report/Crap4j.php` | path coverage when greater than 0, else line coverage | Coverage of 95% or more gives CRAP = CC. Threshold 30. `crapLoad` per method. |
| crap-score 1.2.1 (npm) | Statement coverage of the istanbul statements inside the function's range, nested functions included | CC from ESLint messages |
| @barney-media/crap-typescript-core 2.0.0 | min(statement, branch) | Join by span, with fallbacks. An ambiguous join is "unknown", never a guess. |
| @gligor/crap4ts 1.1.0 | Statements owned by the smallest enclosing function, from V8 | TS compiler API. Counts `??`. Leaves out `?.` and `\|\|=` on purpose, "not a control-flow branch", and defaults, since it scans the body only. |

npm lists about 15 CRAP tools for TS, most published in 2026. crap4n was not fetched. No maintained Python CRAP tool was found on PyPI (`crap` is unrelated). Basis-path coverage is not available from V8 or coverage.py. Statement and branch coverage are.

## 4. The join

**JS/TS** (verified by experiment, Vitest 5.0.3 with coverage-v8): `fnMap` names are not reliable. `const select = (…) => {…}` shows as `(anonymous_7)` while `const plan = …` keeps its name. `decl` starts at the name, and `loc.start` at the body. The tree-sitter body start equals `loc.start` for 375 of 385 functions. Adding the inner start of a parenthesised arrow body, `=> (expr)`, brings 384 of 385. The one left is an arrow whose body starts with a parenthesised operand. Statements and branches belong to the innermost function that holds their start, so a nested function's code is not its parent's. Join and attribution took 11 ms for 26 files.

**Python** (verified by experiment, coverage 7.17.0): JSON `files.*.functions` is keyed by qualified name (`outer_with_inner.inner`, `K.method`). Each entry has `start_line`, own executed and missing lines, branches and a summary, and the module body is `""`. A property getter and setter share `P.x`, and two conditional `def f` share `f`. Only the last survives, so the reported `f` was the one never run. The join must use our own ranges and the per-line data.

**Hard cases.** An anonymous function has no name to join on, so position decides. A class method joins like a function. A decorator is outside the body, so it does not move the join. Generated code was not tested.

## 5. Experiment on `src/`

CC over 607 files (`q5-dist.out.md`, 2.0 to 2.8 s in one process): 7,072 functions. 3,226 have CC 1, 2,541 have 2 to 4, 925 have 5 to 9, 318 have 10 to 19, 38 have 20 to 29 and 24 have 30 or more. Of all increments, 8,899 are control flow, 2,867 are `&&`/`||`, 1,537 are `??`, 1,038 are `?.` and 340 are defaults. 380 functions reach CC 10, and 263 without `?.`, `??` and defaults.

CRAP over `src/core/delivery/` (26 files, coverage from `test/delivery`, 34 files and 348 tests). The test run took 25.4 s wall at load 57. Joining and scoring took 0.2 s. Statement-based CRAP: median 2, p90 8.2, p99 39, max 90. 10 functions are at 30 or more, and 12 when min(statement, branch) is used. Top entries, read:

- `withFlaky.<anonymous#2>` (CC 9, 0%) and `tellUncovered.<anonymous#0>` (CC 6, 0%): real branching that these tests never run. Plausibly risky.
- `readHandoff` (CC 8, 21%): eight guard returns in a JSON validator, tested by `test/daemon/handoff-claim.test.ts`, outside the sample. A false alarm caused by partial coverage.
- `deliver.<anonymous#0>` (CC 39, 98%): the central delivery transaction. CC above 30 fails whatever the coverage. Risky to change. Its tests protect it.
- `livenessTitle` (CC 12, 50%): six `?.` in a message chooser. Lower by reading.
- `parseRequest` (CC 38 in the `src/` top 20): seven fall-through `case` labels for one return. Flat, not risky. `selectTier` (76), `recordTier` (58) and `Ledger.settle` (35) are central scheduling logic.

Two coverage runs of the same tests agreed on hit or miss for 3,062 of 3,062 counters. 26 raw counts differed (`q5-repeat.out.json`).

## 6. Identity and caching

CC is a pure function of the file bytes, the grammar and the counter's rules. 011 C3's file hash, the git blob id that `file_hashes` stores, plus a counter version is a complete key. Several worktrees with one blob share one result through the C7 store. Time: 6.4 to 7.9 ms per blob in the history replay. CRAP is not a function of the blob alone. Its coverage is the union over every test file that runs the function, so it changes when a test changes and is current only when every covering test file has a current result (inferred; collecting coverage is 015-01's topic).

The replay of 300 commits (`q6-history.out.json`) covered 911 changed files and 21,396 functions after the commits. Of the 20,411 functions in files that existed before, 96.1% kept their qualified name (`Class.method`, `outer.inner`). 63 renames kept the same body, which a whitespace-normalised body hash finds. 228 functions (1.1%) share a qualified name with another in the same file. 8,227 (38%) are anonymous. Numbering anonymous functions inside their parent shifted 49 that had the same body. Naming them by call site (`<map#0>`) left 551 functions with a CC change, against 611, and 39 shifts (`q6-history-callsite.out.json`). "CRAP of `parseX` went from 12 to 45" is well defined for a named function with a unique qualified name. It is not for duplicates, and is weak for anonymous functions.

## 7. Python

See sections 1, 4 and 6. tree-sitter-python, already in every plugin, with radon's rules (assert not descended, guards not counted) equals radon 6.0.1 on 2,064 of 2,064 functions in 431 files: this repository, coverage 7.17, radon and lizard. It takes 0.7 to 1.3 s in process, against radon's CLI at 0.7 to 1.0 s, and needs no interpreter. lizard agreed with radon on 1,866 of 2,064 functions and missed 16.

## 8. Can the code squeal?

The reading: a per-function check whose state is "over threshold" or not, with transitions and revision provenance like a test result.

**Holds, for CC.** Cost is a few ms per changed file, in process, with no test run (section 2). It is correct and deterministic: one counter equals ESLint and radon over two corpora. Provenance is exact, because the value is a function of the blob. **Noise**, from the replay: at a threshold of 10, 38 functions crossed up, 16 crossed down and 86 new ones started at or above it, in 48 of 300 commits (16%). At 20 the figures are 13, 3 and 10, in 16 commits (5%). Edits to `?.`-heavy code move CC without changing risk, since 31% of the functions at CC 10 or more are there only through `?.`, `??` and defaults.

**Holds with conditions, for CRAP.** Coverage hit or miss was stable in our sample (n = 2 runs). A CRAP state is current only when every test file covering the function has a current result at the revision. Otherwise it is stale or unknown, as a test is. A partial set overstates risk, as `readHandoff` showed.

**Does not hold.** Identity breaks for the 38% of functions that are anonymous, and for the 1.1% that share a name. Their transitions need a policy: skip them, or follow by position and body hash. A CC crossing is a weak verdict. In the reading above, about half of the top entries were flat code, not risk.

## Recommendation for Squeal

1. **Count with tree-sitter.** web-tree-sitter is already shipped. Add the TSX grammar for `.ts`, `.tsx` and `.js` (+1.45 MB per plugin) and reuse the Python grammar. Use ESLint classic rules for JS/TS and radon's for Python, because peers and users already read those numbers (sections 1, 2, 7).
2. **Key CC by blob id and counter version**, stored once and shared like a result (C3, C7). It stays off the run path.
3. **CRAP by Savoia's formula, threshold 30.** Use own-statement coverage, and say so where it is shown, because basis-path coverage is unavailable. Use PHPUnit's rule that coverage of 95% or more gives CC. Report CC of 30 or more as such, since no coverage clears it (section 3).
4. **Join by position, never by name.** JS/TS: body start against `fnMap.loc.start`. Python: own ranges against per-line coverage data (section 4).
5. **Function identity.** Use file, qualified name and an occurrence index, name anonymous functions by call site, and follow renames by body hash. For a check type of its own, only CC of named, unique functions holds today (sections 6, 8).

## Open questions

1. Is a threshold crossing worth a push at 16% of commits (CC 10) or 5% (CC 20), when about half of the top list is flat code? 015-03 and the human decide.
2. Should `?.`, `??` and defaults count? ESLint counts them. Excluding them drops 31% of the CC-10 functions, but makes Squeal's number differ from every peer's.
3. The cost and fidelity of per-test-file coverage, and its merge into per-function coverage, decide whether CRAP is current. That is 015-01.
4. oxc's wasm32-wasi binding inside a committed bundle, and tree-sitter-typescript's lag behind TS syntax: not tested.
5. crap4n: not fetched.

## Sources

- ESLint 10.13.0 `lib/rules/complexity.js`. typhonjs-escomplex 0.1.0 and `escomplex-plugin-syntax-estree/src/PluginSyntaxESTree.js`. Biome 2.6.2 `configuration_schema.json`. All from npm into `/tmp/r01502/js`.
- Biome docs: https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/
- lizard 1.24.2 `lizard_languages/code_reader.py`, `python.py`, `typescript.py`. radon 6.0.1 `radon/visitors.py`. mccabe 0.7.0 `mccabe.py`. All PyPI sdists.
- G. Ann Campbell, "Cognitive Complexity", SonarSource, version 1.7, 2023-08-29: https://redirect.sonarsource.com/doc/cognitive-complexity.html
- A. Savoia: https://www.artima.com/weblogs/viewpost.jsp?thread=210575 and https://www.artima.com/weblogs/viewpost.jsp?thread=215899
- php-code-coverage 14.4.1: https://github.com/sebastianbergmann/php-code-coverage/blob/14.4.1/src/Node/CrapIndex.php and `src/Report/Crap4j.php`, `src/Node/File.php`
- npm: crap-score 1.2.1, @barney-media/crap-typescript-core 2.0.0, @gligor/crap4ts 1.1.0 (`dist/` read)
- coverage.py 7.17.0, `CHANGES.rst` at tag 7.17.0 (JSON per function in 7.6.0, `start_line` in 7.13.1): https://github.com/nedbat/coveragepy/blob/7.17.0/CHANGES.rst
- web-tree-sitter 0.27.1, tree-sitter-typescript 0.23.2, tree-sitter-javascript 0.25.0, oxc-parser 0.155.0, typescript 5.9.3 and this repository's 7.0.2, acorn 8.19.0. Squeal's `src/harness/build.ts`, `src/runners/pytest/graph/README.md`, 007 D4, 011 C3 and C7.
