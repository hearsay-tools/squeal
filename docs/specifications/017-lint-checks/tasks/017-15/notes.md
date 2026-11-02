# 017-15: oxlint in the lint pass, policy, store and lines

Worker 0b51c4f8, 2026-11-02. Spec D1, D5, D7, D8, D11; brief `tasks/wave-5.md` W1. With `lint.enabled`, the daemon runs one lint pass per tool. A project with oxlint installed gets oxlint checks beside ESLint's, and ESLint-only output stays byte-identical.

## Seam map

| Where | What changed |
| --- | --- |
| `src/core/types/lint.ts` | `LintTool = "eslint" \| "oxlint"`. |
| `src/core/lint/pass/provider.ts` | `LintDeclaration.tool: LintTool`. `OxlintProvider` is now a `LintProvider` with no other change. |
| `src/cli/daemon.ts`, `src/core/daemon/daemon.ts` | `startDaemon`'s `lintProvider` became `lintProviders: { eslint?, oxlint? }`. The daemon makes one pass per tool with a provider, with `lint.enabled`, and closes all at stop. A pass's error note reads `lint: ...` for ESLint, `lint (oxlint): ...` for oxlint. |
| `src/core/lint/pass/types.ts`, `index.ts`, `run.ts` | `LintPassOptions.tool` (default `eslint`). A pass whose tool `lint.tools` leaves out opens no provider. Once, it removes that tool's states in the worktree and its records (`retire`), with no transition. |
| `src/core/lint/pass/records.ts` | `lintScope(worktreeId, tool)`: ESLint's records keep their keys; oxlint's sit under `<worktree>:oxlint`. The keying record (`lint-keying:<worktree>`) is shared: every tool's pass writes it, so a delivery's summary and the D8 cut follow the last keying of any tool. `forgetRecords`, `isNotInstalled`. `writeOff(..., tool)`: another tool's "not installed" is no notice. |
| `src/core/lint/pass/judge.ts`, `rekey.ts`, `parts.ts`, `lint-part.ts` | Each takes the tool from its context: checks, state reads (`LintStateFilter.tool`), results. `JudgeAt.tool` and `resultOf(..., tool)` are optional, absent meaning ESLint, so W3's `test/lint/wiring/delivery.test.ts` compiles unchanged. |
| `src/core/lint/pass/refresh.ts`, `session.ts` | `isConfigOf(tool)`: ESLint's flat configs, or `isOxlintConfigInput`. It drives `refreshLevel`, `mayTurnOn` and the config keying in `rekey.ts`. |
| `src/core/lint/pass/keys.ts` | A file's key also holds the blobs of `declaration.configFiles`. See decision 2. |
| `src/core/lint/pass/keyer.ts`, `segment-disk.ts`, `lint-part.ts` | After a whole-program part whose report names no program (oxlint), the segment's listed files are hashed on disk again. See decision 3. |
| `src/core/lint/store/checks.ts`, `states.ts`, `types.ts` | `TOOLS` holds `oxlint`; `states.list` takes a `tool` filter. Schema stays 1. |
| `src/core/daemon/policy-lint.ts`, `src/core/types/policy.ts` | `lint.tools`, default `["eslint", "oxlint"]`. A name other than these two is a wrong value; the default applies. `[]` is valid: lint on, no tool. |
| `src/core/lint/surface/news.ts`, `deliver.ts`, `told.ts` | (W3's files, by agreement, commit `7aafbc622`.) Keyed by check name (`lintCheckName`): the path for ESLint, the path and tool for another tool. The told mark stores `[path, id]` for ESLint and `[path, id, tool]` for another tool. `LintNewsEntry.tool` is set only for oxlint. |
| `src/core/lint/surface/snapshot.ts` | Progress over every tool's records. `reasonsOf`: `off` only while no tool lints; `toolsOff` holds other tools' reasons. Notices sum over tools. See decision 4. |
| `src/core/lint/surface/report.ts`, `format.ts`, `src/cli/lint-report.ts` | Keyed by check. `tool` on details, `--changed` entries and Stop files, set only for oxlint. Lines: `FAIL lint: src/a.ts (oxlint): ...` (also PASS and RESOLVED); `squeal lint` text names the tool after the path; status and `squeal lint` print `toolsOff` as `Lint: off: <reason>.` lines. |

## Decisions the spec did not settle

1. **One pass per tool**, each with its own provider, checks and records, over one `lint.sqlite`. One shared keying record (conservative: an oxlint config keying also cuts earlier ESLint transitions from the D8 evidence). Status counts are checks (file x tool), still worded "files". The parent accepted these on 2026-11-02.
2. **Config files in every key.** oxlint's closure leaves out its config files; they are only in `configFiles`. The pass keyed a file by its closure, so with no import plugin a root config edit (a rule's severity) hit the old key. Now `lintKey` holds `configFiles` too. ESLint's closure already holds each config file ESLint loaded (`session.ts` `computed`), so no stored ESLint key changes; `LINT_KEY` stays `squeal-lint-key/4`. `test/lint/oxlint/pass.test.ts` fails without it. In modes A and C the replay passed even without it, because the import plugin makes every file whole-program and the program segment holds the configs' JSON bytes.
3. **The segment on disk** (017-14 notes, proposal 6). After a whole-program part whose report names no program, the pass hashes the segment's listed module files with `hashFile`. A file at other bytes than the listing's spoils the part's whole-program misses: nothing is stored, and the pass looks again in 1 s. Cost: one read and hash per listed module file per such part; not measured on a large program. It applies to ESLint only when ESLint reports an empty program for a whole-program file.
4. **Off reasons per tool.** `off` is set only while no tool lints (a tool lints once it keyed and is not off). Then `off` is the first reason that is not "not installed", ESLint's first, else the first reason. While a tool lints, the other tools' reasons are `toolsOff`, and "not installed" is left out (D11: "A tool not installed gives no status line"). The policy cannot tell a default `lint.tools` from a written one, so "unless `lint.tools` names it" is not applied: with neither tool installed, ESLint's line shows, as in the release before. "Not installed" is read from the reason's words (`/^no (ESLint|oxlint) installed in /`).
5. **An off tool keeps its states.** Its last results stay counted in status and registration, with its `Lint: off:` line beside them, as an off ESLint's results stay stored. Hiding them would need `deliver.ts` too.
6. **`lint.tools` re-keys nothing.** It is not in any key or cursor environment: removing oxlint does not move ESLint's keys. A removed tool's states and records go once (`retire`); when it returns, its next pass is a first keying.
7. **Registration stays one line.** `toolsOff` rides in the registration's data but not in its line. Delivery's off news (`deliver.ts`, W3) is still `reasons.off` only, so an oxlint off while ESLint lints is told in status, not in a delivery.

## Type changes (all additive)

`LintTool` gains `"oxlint"`; `LintDeclaration.tool: LintTool`; `LintStateFilter.tool?`; `JudgeAt.tool?`; `resultOf(..., tool?)`; `lintCheck(path, tool?)`; `LintPassOptions.tool?`; `PartsContext.tool`, `RekeyContext.tool`, `PassState.tool` (internal); `Policy.lint.tools`; `LintNewsEntry.tool?`, `LintFileDetail.tool?`, `LintChangedEntry.tool?`, `LintStopFile.tool?`, `LintReasons.toolsOff?`; `LintToldMark.deferred` holds check names (its stored form is unchanged for ESLint). `DaemonOptions.lintProvider` was replaced by `lintProviders` (the only callers are `src/cli/daemon.ts` and `test/lint/pass/daemon.test.ts`).

## An older Squeal meeting an oxlint row (the parent's condition for keeping schema 1)

0.1.391's `checkFrom` throws `squeal store: tool has unexpected value oxlint` on an oxlint check row. Only rows of its own worktree reach it: states, transitions and views are read per worktree, and results by `(path, tool)`. So only a downgrade in a worktree a newer Squeal linted with oxlint meets it. Measured on 0.1.391's own code (`git archive 55a9aaa61`, a probe test in scratch with an oxlint pending state in the worktree):

| Path | 0.1.391 |
| --- | --- |
| Registration (`registerLint`) | `undefined`: the lint part is left out; the hook goes on |
| Delivery (`tellLint`) | `null`: no lint news; the hook goes on |
| Status (`lintStatus`) | `undefined`: no lint line |
| `squeal lint` (`lintDetails`) | `undefined`: prints "The lint store cannot be read." and exits 1 |
| `squeal lint --changed` | read, no entries |
| Stop (`lintStop`) | `null`: lint blocks nothing |
| Daemon pass | one note, `lint: squeal store: tool has unexpected value oxlint`; the pass closes its provider and opens a new one at each later pass (opens 2, then 3), and the daemon keeps running |

No path ends the daemon or a hook (`withLint` catches; the pass loop catches). The cost: until a newer Squeal runs there again, each pass reloads ESLint (about 0.4 s of CPU). Schema 1 stands, per the parent's rule.

## Tests

| File | What it shows |
| --- | --- |
| `test/lint/surface/tools.test.ts` | Pure: two checks on one path give two entries, oxlint's with its tool; deferred apart; the told mark's stored form. |
| `test/lint/pass/tools.test.ts` | Two fake passes on one tree: two checks per file, a transition per tool, own cursors; a config edit keys only its tool; oxlint off is no ESLint off; `lint.tools: ["eslint"]` closes oxlint, removes its checks and a fresh pass opens no provider; a listed file moved during a whole-program oxlint part stores nothing. |
| `test/lint/pass/daemon.test.ts` | A real daemon with both providers: two checks per file; `lint.tools: ["eslint"]` calls the oxlint factory no more and removes its checks. |
| `test/lint/surface/two-tools.test.ts` | Store-backed: D11's lines in delivery, `squeal lint` and `--changed`; `toolsOff` in status; "not installed" silent. ESLint alone and ESLint beside an oxlint that is not installed give byte-identical registration, deliveries, status, `squeal lint` and `--changed`, also with ESLint not installed. |
| `test/lint/oxlint/pass.test.ts` | Real oxlint through the pass: a config's rule change re-lints with no import plugin. |
| `test/lint/oxlint/pass-replay.test.ts` | The 017-12 replay, modes A (42 steps) and C (51 steps), through the pass with the real oxlint: after each edit every module file's oxlint check equals a fresh whole oxlint run. An installed package's edit also rewrites `package-lock.json`, as an install would; the test's install fingerprint reads the package's files. |
| `test/lint/policy.test.ts`, `test/types.test.ts` | `lint.tools`'s default, a written list, `[]`, a wrong name. |

`test/lint/oxlint/disk.ts` is a `LintSource` read from disk; `replay.ts` now exports the replay's `truth` and `listing`.

Measured, nice 10, load 32 to 49: mode A 39 s wall (13 s user, 19 s sys); mode C 78 s wall (45 s user, 23 s sys).

## What the next row must know

- W3's Stop work meets the check-name keying in `news.ts` and `deliver.ts` (commit `7aafbc622`, which integrates first).
- Delivery's off news for a tool that is off while another lints is not told (decision 7). `deliver.ts` would read `reasons.toolsOff`.
- `isNotInstalled` matches the providers' words. A provider that changes its "not installed" text must change it too.
- The segment recheck (decision 3) has no cost measure on a large program.
- Type-aware oxlint stays off (row 017-16).
