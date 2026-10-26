# What one linter or type-checker check is

Researcher 016-33, 2026-10-26, Squeal at `6f8a579a1`. Brief: [diagnostic-identity-brief.md](diagnostic-identity-brief.md). Probe: [probes/diagnostic-identity/](probes/diagnostic-identity/README.md). Tools: TypeScript 7.0.2 (native `tsc`), ESLint 10.13.0, `@microsoft/eslint-formatter-sarif` 3.1.0, Ruff 0.17.2 (`30516b42`), typescript-eslint 8.72.0 with TypeScript 6.0.3, Node v24.21.0. No timings, no test suite, no agent session.

**Verdict:** store one check per file per tool, holding the file's whole set of findings, with a failure fingerprint that has no line numbers (candidate a-set). In the replay it gave no false recovery, no false new failure and no hidden change, at most one notice per changed file. A per-finding check (b, c) gave a false `FAIL -> PASS` on three of seven edits with every tool.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Candidates | (a) `(tool, file)`, state FAIL while the set is non-empty, set replaced each run; two fingerprints tried: a-loc (today's C5: first finding with its line) and a-set (sorted rule and message of every finding, no line). (b) `(tool, file, rule, message, hash of the line text without whitespace, occurrence index)`, no line number. (c) the tool's fingerprint: only Ruff's GitLab output has one; tsc, ESLint and Ruff's SARIF have none. | verified by experiment; read in source code |
| 2 | Replay | Table below. a-set: every notice true. b: false `FAIL -> PASS` on rename, on fixing the first of two identical findings and on a move; false new FAIL on rename and move. c (Ruff): rename survives, but fixing one finding shifts the IDs of the others of the same rule. | verified by experiment |
| 3 | What the agent reads | a: at most one notice per file per edit. b and c: one per finding, up to one per finding below an inserted line if the line enters the fingerprint. Under b and c a fixed finding reads as still failing (s4); under a-loc a new or fixed finding stays hidden (s3, s4, s7). | verified by experiment |
| 4 | Inputs | tsc and typed ESLint: config, tool version, lib files and every file of the program; an edit to `b.ts` alone made a new finding in `a.ts`. Core ESLint rules and Ruff's F rules: the file, the config and the tool version; the same edit changed nothing. Ruff's isort rules also read the project layout (`src`). This decides the scope of the key and run, not a against b. | verified by experiment; read in source code |

## Findings

### Q1. The candidates as tested

- **(a) per file.** Check `(tool, file)`. PASS when a complete run of the tool's scope reports no finding in the file. Each run replaces the whole set, as LSP's `publishDiagnostics` does ([check-protocol.md](check-protocol.md) §3). A changed fingerprint is C5's `fail -> fail` transition. **a-loc** uses today's C5 fingerprint, the first finding with `file:line:col` (011 C5). **a-set** uses the sorted multiset of `rule|message`, with no lines and no columns.
- **(b) per finding, content anchor.** `compare.mjs` builds `file|rule|message|sha256(line text without whitespace)#n`, where `n` counts equal anchors in the file in output order. This is 016-03's anchor plus the file. Two variants: with or without the line in the failure fingerprint. The line is never in the ID.
- **(c) the tool's fingerprint.** tsc's text output carries `file(line,col): error TSnnnn: message` and no ID. The ESLint SARIF formatter writes no `fingerprints` or `partialFingerprints`; its source has no such word. Ruff's SARIF has none (**verified by experiment**, all three). Ruff's `--output-format gitlab` has `fingerprint`: a `DefaultHasher` over the rule name and the relative path; if the value is taken, the previous value is added as a salt and hashed again (`crates/ruff_db/src/diagnostic/render/gitlab.rs` lines 95–102, 165–173, **read in source code**). So it is the n-th finding of one rule in one file, with no message and no position.

### Q2. Replay

Seven edits, applied in order to the same fixture in each language (probe README). Notices are what Squeal would record as transitions. The rows are the same for tsc, ESLint and Ruff, except s7, which yields a finding only in tsc. Column c is Ruff only. "False" means against the experimenter's label of each finding. From [`out/compare.txt`](probes/diagnostic-identity/out/compare.txt), **verified by experiment**.

| Edit | True change | a-loc (today's C5) | a-set | b, no line in fingerprint | c, Ruff GitLab |
|---|---|---|---|---|---|
| s1 insert a line above | none | `a` FAIL→FAIL changed (false) | none | none (with line: 3 × changed, false) | none |
| s2 rename `count` → `tally` | none; message and line text change | `a` changed | `a` changed (message did change) | `unused` FAIL→PASS (false) + new FAIL (false) | none |
| s3 add identical `report(1)` | 1 new | **none (hidden)** | `a` changed | `report#2` new FAIL | new FAIL |
| s4 fix the first of the two | alpha's `report` fixed | **none (hidden)** | `a` changed | `report#2` FAIL→PASS, but `#2` was gamma's, still failing (false); `#1` silently becomes gamma's | the s3 ID FAIL→PASS (false); `notify` silently takes `report`'s old ID |
| s5 move `beta` to `b` | none; a finding changes file | `b` new FAIL | `a` changed, `b` new FAIL | `a` `notify` FAIL→PASS (false), `b` new FAIL | same as b |
| s6 fix last finding of `b` | `notify` fixed | `b` FAIL→PASS | `b` FAIL→PASS | FAIL→PASS | FAIL→PASS |
| s7 change only `b`'s type (tsc) | 1 new in `a` | **none (hidden)** | `a` changed | new FAIL | n/a (no finding) |

Totals over s1–s7 for tsc: a-loc 4 notices, 3 hidden changes; a-set 7, all true; b without line 8, 3 false FAIL→PASS and 2 false new FAIL; b with line 14. ESLint and Ruff: one fewer each (no s7 finding). c: 5 notices, 2 false FAIL→PASS, 1 false new FAIL. A move under a-set reads "`a` changed, `b` new FAIL", which is true per file; under b and c it reads as a fix that did not happen.

No content anchor survives both s2 and s4. A rename changes the message and the line text, so an anchor built from either breaks (b). An anchor built from neither is positional, so removing one finding renumbers the rest (c). **Inferred** from the two results; it holds for any anchor drawn from rule, message, line text and order.

### Q3. What the agent reads

- **Count.** a: one notice per file whose set changed, whatever the number of findings. b: one per finding; with the line in the fingerprint, an inserted line gives one notice per finding below it (3 in s1 here). **Verified by experiment.**
- **A fixed finding read as still failing.** b and c in s4: the agent removed alpha's `report`; the notice says the gamma finding passed, and the check that still fails has alpha's ID. a-set says only "`a` changed"; it states nothing false. **Verified by experiment.**
- **A new finding hidden.** a-loc in s3 and s7, and a fix hidden in s4, because only the first finding enters today's fingerprint. a-set has one gap: an edit that fixes one finding and adds an equal one in the same file leaves the multiset equal, so no notice (**inferred**, not run). b has the same gap.
- **What a-set's notice must carry.** "changed" alone does not say which finding. Matching the old and new sets by b's anchor, as evidence only, would name the added and removed findings without making them checks (**inferred**). The s4 result shows that this matching can name the wrong one of two identical findings; there the count is still right.

### Q4. Inputs besides the file

| Tool | Decides the findings | Tag |
|---|---|---|
| tsc 7.0.2 | `tsconfig.json`; the compiler version; 63 `lib.*.d.ts` files of the package (`--listFilesOnly`); every program file. s7: changing only `b.ts` added TS2322 to `a.ts`. `tsc a.ts` with a `tsconfig.json` present fails with TS5112 ("will not be loaded if files are specified on commandline"), so one file cannot be checked under the project's config; that error has no file. | verified by experiment |
| ESLint 10.13.0, core rules | `eslint.config.js` and what it imports, the ESLint version, `languageOptions.globals` (for `no-undef`). s7: no change in `a.js`. | verified by experiment |
| ESLint with typed rules | Also the tsconfig, the TypeScript version and every program file: with `a.ts` unchanged, `no-floating-promises` passed when `b.ts`'s `load` returned `number` and failed when it returned `Promise<number>` ([`out/typed-eslint.txt`](probes/diagnostic-identity/out/typed-eslint.txt)). | verified by experiment |
| Ruff 0.17.2 | The nearest `ruff.toml`/`pyproject.toml`, the Ruff version. s7: no change in `a.py`. For isort rules, the project root and `src` directories decide first- vs third-party imports (`crates/ruff_workspace/src/options.rs`, `src` option). | verified by experiment; read in source code |

For the candidate choice: whether a file's findings depend on other files does not separate a from b. Both attach findings to a file; under both, a file's key must hold the program's files for tsc and typed ESLint, and a run must cover the program. For core ESLint and Ruff, a per-file run and key are sound. **Inferred.**

## Recommendation for Squeal

1. **One check per file per tool, whole set replaced, no line in the fingerprint (a-set; Q2, Q3).** It is the only candidate with no false notice in the replay. It gives at most one notice per changed file, which fits the vision's "few transitions over exhaustive notifications" and decision-filter question 2 (less noise). It needs no promise of per-finding identity, as [check-protocol-judgment.md](check-protocol-judgment.md) divergence 1 asked.
2. **Do not reuse today's C5 fingerprint for these checks (Q2).** a-loc hid three of the seven changes and reported two that did not happen.
3. **Name what changed inside the notice, not as checks (Q3).** Match old and new sets by rule, message and line text to list added and removed findings. Treat that list as evidence that can be wrong for identical findings.
4. **Do not use a tool fingerprint as a check ID without testing it (Q1, Q2).** Ruff's is positional per rule and moved between findings when one was fixed.
5. **Key and run scope follow the tool, not the unit (Q4).** For tsc and typed ESLint, a file check's key holds the whole program and a run checks the whole program; recovery needs that complete run. For core ESLint and Ruff, file plus config plus tool version.

Limits: one small fixture per tool, seven edits, three rules each. The labels of "true" changes are the experimenter's. Repeating a rule on one line and the equal-fix-and-add gap were not run. The ESLint typed run used TypeScript 6.0.3, not 7.0.2.

## Open questions

1. A project-level diagnostic with no file (TS5112 here; SARIF results without a physical location) has no file check to hold it. Which check holds it is not determined by this probe.
2. Whether agents act better on one "`a.ts` changed: +1 `report`, −1 `report`" notice than on per-finding notices: not determined; it needs an agent session, which the brief excludes.
3. How a-set behaves for a file with hundreds of findings (one notice listing many changes): not tested.

## Sources

- Probe and raw outputs: [probes/diagnostic-identity/](probes/diagnostic-identity/README.md), `out/compare.txt`, `out/typed-eslint.txt`, `out/versions.txt`.
- Ruff 0.17.2, https://github.com/astral-sh/ruff at `30516b42ab972ffa2569e5efcfee81135da466d3`: `crates/ruff_db/src/diagnostic/render/gitlab.rs`, `crates/ruff_workspace/src/options.rs`.
- `@microsoft/eslint-formatter-sarif` 3.1.0, `sarif.js` from npm (no `fingerprint` in the file).
- Squeal at `6f8a579a1`: [011 C3 and C5](../../011-core/spec.md), [docs/vision.md](../../../vision.md) (lines 205, 258–267), [check-protocol.md](check-protocol.md) §3, [check-protocol-astra.md](check-protocol-astra.md) §3, [check-protocol-judgment.md](check-protocol-judgment.md) divergence 1 and spec input 7, [plugin-mechanisms.md](plugin-mechanisms.md) (per-file linter and project type checker rows).
