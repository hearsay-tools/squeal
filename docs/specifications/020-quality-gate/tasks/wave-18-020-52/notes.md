# Row 020-52: one rule for "may this CI part stand for a run here"

Worker 6542818c, wave 18, shape slice (a refactor). Base: main at `7d081d646`.

## 1. Refusal branches before this row, side by side

Line numbers are at the base commit. "Gate" is `squeal code --base --parts` (`partsEvidence`, `src/core/code/gate/parts.ts`). "Export" is `squeal ci export` (`ciExport`, `src/core/ci/export.ts`; `partsRefusal`, `export-check.ts`; `certifier`, `export-inputs.ts`).

### Per set of parts (export only)

| Export branch | Where | Gate counterpart |
| --- | --- | --- |
| `key-format`, `incomplete`, `snapshot` of any project of any part (`reuseRefusal(named)`, no place) | `export-check.ts:76` | Same rule, per file's project, at step 3 below (`environment`) |
| `no-commit`, `commits`, `checkout` | `export-check.ts:78-94` | None: the gate takes parts of any commit; inputs certify content |
| `shards` (count, index, missing, two parts of one shard) | `export-check.ts:191` | None: the gate takes any subset of parts |
| `duplicate`: the first test file two parts hold refuses the export | `export-check.ts:220` | Step 1, per file |
| `environment` between two parts of one project | `export-check.ts:240` | None |
| `environment` of every project of every part at the job (`reuseRefusal(named, here)`) | `export.ts:261` | Step 3, per file's project at the gate runner |

### Per test file

| Order | Gate branch (D13.2 reason) | Where (base) | Export branch | Where (base) |
| --- | --- | --- | --- | --- |
| 0 | not Vitest, or no part holds it: no evidence, no refusal | `parts.ts:109`, `:115` | a file only the parts list | `export.ts:149` |
| 1 | `duplicate`: two parts hold it | `parts.ts:160` (`ownerOf`) | set refusal (above) | `export-check.ts:220` |
| 2 | `unusable`: its part gives no coverage evidence (`unusable(part)`), or `coverage.children` at the base | `parts.ts:61`, `:89`, `:168` | none: an export carries no records (D13.3) | |
| 3 | `environment`: `reuseRefusal(named, gatePlace, project)` | `parts.ts:124`, `parts-environment.ts:56` | set refusal (above) | `export.ts:261` |
| – | (gate takes a failed file) | `parts.ts:246` | `failed`: left out, counted | `export.ts:150` |
| – | none | | `ambiguous`: two checks of one name with no location | `export.ts:136`, `:151` |
| – | none (a passed file with `noRecord: "inspector"` reads `record`) | | `inspector`, `unwatched`: `node:inspector` beside a provider (D13.4, D19.6) | `export.ts:153-164` |
| – | none: the gate's files are the runner's list | | not listed by the runner: counted `unkeyed` | `export.ts:230` |
| 4 | `closure`: the runner gives no closure here | `parts.ts:135` | closure throws: counted `unkeyed` | `export.ts:231` |
| – | none: the gate keys nothing | | no key, closure or key parts: counted `unkeyed` | `export.ts:181` |
| 5 | `input`: `uncertifiedWhy` over closure and `inputsOfReadsHere`, content from the bytes on disk; first by name, how, how many more | `parts.ts:240` | `uncertified`: `uncertified` over the keyed closure, content from the job's stat cache; all paths, closure order | `export-inputs.ts:16` |
| 6 | `record`: passed, no record | `parts.ts:248` | none (D13.3) | |
| 7 | `unread`: the record could not read a changed path | `parts.ts:252` | none | |
| 8 | `source`: the record holds other bytes of a source | `parts.ts:254` | none | |

Shared before this row: `reuseRefusal` (steps 3 and the set's run rule), `uncertifiedWhy`/`uncertified` and `hereOf` (`inputs.ts`). Private: the index of which parts hold a file (three copies: `parts.ts:81`, `export-check.ts:221`, `export-inputs.ts:22`), every reason's text and shape, the order.

## 2. The module's shape

New module: `src/core/ci/reuse.ts` (under `src/core/ci/`, since the gate already imports `ci/` and `ci/` imports nothing of the gate). It holds:

- `ReuseReason`, `FileRefusal`: the eight reasons of D13.2 and the refusal the report gives (D7 `runs[].refused`). `gate/parts-refused.ts` keeps `PartRefusalReason` and `GatePartRefusal` as aliases of them, so `report.ts`, `runs.ts`, `types.ts` and the tests import as before.
- `FileReuse`, built over the parts with `ReuseOptions`. It indexes which parts hold each test file once (`testFileId`), and gives one step per reason group, in the gate's order:
  - `owner(ref)`: `duplicate`, `unusable`; the one `Holder`, or `null` when no part holds the file.
  - `environment(holder, project, check)`: `environment`, from the reader's `RunCheck`, which is `reuseRefusal` at the reader's place.
  - `closure(holder, closure)`: `closure`; the closure, or the refusal.
  - `evidence(holder, inputs, here)`: `input`; then, with the option `records`, `record`, `unread`, `source`. It returns the refusal and, for `input`, every input not certified in the order given.
  - `unusable`: with `records`, each part that gives no evidence and why, in the parts' order (the gate's one note per reason).
- `firstShared(parts)`: the first test file a later part holds again, with both part names, for `ci export`'s whole-set `duplicate` refusal.
- `partUnusable(part)`: the coverage reasons a part gives no records (was `unusable` in `gate/parts.ts`).

Why steps, not one function: each reader reads what the next step needs in batches between steps. The gate awaits the runner's environments once, and only when some file has one usable holder. It loads closures one file at a time, then asks git once for the observed reads of every candidate (`inputsOfReadsHere`). `ci export` keys every file (closures, observed growth, the index) between its ownership check and its input check. One function per file would either lose those batches (one git call per file) or load closures for files a part already refused. The order is kept by the types: `environment`, `closure` and `evidence` take the `Holder` that only `owner` gives.

`reuseRefusal` stays in `export-check.ts`: it is the run rule, shared since 0.1.427-r2, and the export also applies it to whole sets of parts (every project, no file). `FileReuse.environment` turns its answer into the file's `environment` reason.

Callers now:

| Reader | Calls |
| --- | --- |
| Gate, `gate/parts.ts` `partsEvidence` | `new FileReuse(parts, { records })`, `unusable` for its notes, then `owner`, `environment` (with `environmentCheck` from `parts-environment.ts`), `closure`, `evidence` |
| Export, `export-check.ts` `duplicateRefusal` | `firstShared` |
| Export, `export-inputs.ts` `certifier` | `new FileReuse(parts)`, `owner`, `evidence` |
| Export, `export.ts` | `certifier` (now async), and `reuseRefusal` for the job's place, as before |

## 3. Deliberate differences, as named options or questions

| # | Difference | How the module takes it | Test |
| --- | --- | --- | --- |
| 1 | Records. The gate's evidence is a coverage record too (D13.1): a part whose records this Squeal does not read, or `coverage.children` at the base, gives no file (`unusable`); a passed file with no record, a record that could not read a changed path, or one that holds other bytes of a source, is not given. `ci export` carries no records (D13.3, D19.5). | Option `records` (`changed`, `children`) of `FileReuse`; absent for the export | `test/ci/reuse.test.ts`, "FileReuse option records": 6 tests (unusable collector; children; passed with no record; failed with no record; unread; source) |
| 2 | Failed files. The gate gives a failed file with no record (D5: the failure makes the verdict incomplete). The export leaves each failed file out before it asks anything (an export holds passes; count `failed`). | Inside option `records`; the export's filter stays its own (`export.ts:150`) | "a failed file with no record is evidence at the gate"; export: `test/ci/export*.test.ts` counts, unchanged |
| 3 | Content here. The gate hashes the bytes on disk; the export reads the job's stat cache (`hereOf`'s file reader). | Argument `here` (`Content`) of `evidence`; read only for an input the part holds evidence of | "reads content here through the reader's own reading" |
| 4 | Which inputs. The gate certifies the closure here plus what the file read (`inputsOfReadsHere`); the export certifies its keyed closure, grown by what the shard observed (`observedGrowth`, `addObserved`). One keying path for both is row 020-51. | Argument `inputs` of `evidence`; the same certification and the same first-by-name `input` refusal | "the gate's refusal names the first input by name; the export's certifier lists them all" (one parts set, both readers) |
| 5 | Duplicate scope. The gate refuses only the file two parts hold, naming the first part by name; the export refuses the whole set, naming the first two holders in the parts' order. | Two named questions: `FileReuse.owner` (per file) and `firstShared` (per set) | "duplicate: one file at the gate, the whole set at the export" |
| 6 | Run scope. The gate asks `reuseRefusal` of the file's project at the gate runner (`gatePlace`); the export asks of every project of every part at the job, so a part with one bad project refuses the export. | Argument `check` (`RunCheck`) of `environment`; the export calls `reuseRefusal` without a project, as before | "environment: the gate asks of the file's project, the export of every project" |
| 7 | Closure. The gate refuses the file (`closure`); the export counts it `unkeyed`. | Step `closure`; the export does not report reasons per file | "closure: the gate refuses the file; the export counts it unkeyed" |

Export-only branches that stay in `export.ts`, because they are not reasons of D13.2 and the gate has no counterpart: the set checks (`no-commit`, `commits`, `checkout`, `shards`, `environment` between parts), `ambiguous` (the gate keys no check names), `inspector` and `unwatched` (D13.4, D19.6; at the gate a passed file the part marks `noRecord: "inspector"` reads `record`), and a file the runner does not list or the job cannot key.

## 4. What changed inside, with no change in output

- The gate hashes an input's bytes only when the part holds evidence of it, as `uncertified` always did for the export. Before, it hashed every input first. The verdict is the same: an input the part holds no evidence of is `unrecorded` before its content is read.
- The export's `certifier` finds the file's part through `FileReuse.owner`. With two holders it now treats every input as uncertified, where it took the last part's evidence. `ciExport` cannot reach that case: `partsRefusal` refuses the set first.
- `export.ts` builds its exported files in a `for` loop with `await`, since `certifier` is async (the gate's `here` is async). Same order, same files.

## 5. Type changes

- New: `src/core/ci/reuse.ts` exports `ReuseReason`, `FileRefusal`, `Holder`, `RunCheck`, `Content`, `EvidenceRefusal`, `ReuseOptions`, `RecordsOption`, `FileReuse`, `firstShared`, `partUnusable`.
- `gate/parts-refused.ts`: `PartRefusalReason` and `GatePartRefusal` are now aliases of `ReuseReason` and `FileRefusal`; same shape.
- `gate/parts-environment.ts`: `Certify` is now an alias of `RunCheck`; same shape.
- Not additive: `gate/parts.ts` no longer exports `unusable` (now `partUnusable` in `ci/reuse.ts`); nothing imported it. `certifier` (`ci/export-inputs.ts`) now returns `Promise<readonly RelativePath[]>`; `export.ts` is its only caller.

## 6. Done-when mapped to tests

| Done-when | Evidence |
| --- | --- |
| Every existing parts, export and `ci` test passes with no assertion changed | No existing test file changed (`git diff 7d081d646 -- test/` adds only `test/ci/reuse.test.ts`). Squeal at revision 14: `test/code/gate/parts{,-refused,-environment}.test.ts`, `test/code/gate/report-refused.test.ts`, `test/ci/export{,-check,-evidence,-keys,-formats,-snapshot,-wrapper}.test.ts`, `test/ci/inputs{,-here}.test.ts`, and the CLI tests `test/cli/ci-{export,export-children,publish,record,usage}.test.ts`, `test/cli/code-gate-parts{,-cases,-environment,-link,-unstarted}.test.ts`, `test/cli/code-gate-stored.test.ts` all pass. |
| Each refusal reason of D13.2 comes from the one module | `grep -rnE 'reason: "(duplicate\|unusable\|environment\|closure\|input\|record\|unread\|source)"' src/` finds them in `src/core/ci/reuse.ts` only (two unrelated hits in `status-wait-ask-store.ts` and `crap/loaders.ts` are other types). |
| A test per deliberate difference | Section 3, column "Test": `test/ci/reuse.test.ts`, 11 tests. |
| No change to report fields, stderr text, exit codes or exports | The gate's report and stderr tests (`parts-refused`, `report-refused`, `code-gate-parts*`) and the export's text, counts and bundle tests (`export*`, `ci-export*`) pass unchanged. |

## 7. Checks run and not run

Run, with their real results:

- `pnpm run lint`: `Checked 3343 files in 1274ms. No fixes applied.`
- `pnpm run typecheck` (`tsrs --fast --noEmit`): no errors.
- `squeal status --wait 60000` over the seven changed source files and `test/ci/reuse.test.ts`, revision 16 (commit `4b1c5b9fb`): Squeal selected 351 affected test files. Final output at revision 17 (only this notes file changed since 16): `Named test files at revision 17: 4 known failures: 4 tests; 351 test files, each with a current result`. So 347 pass and 4 fail, the four below. 6 worktree test files stay unknown (not in this selection).
- Known failures, all four expected and not fixed here: the bundle-drift tests `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` ("cli/squeal.mjs differs from the build"). The wave forbids `pnpm run build` in a worker tree, and this row does not own `plugins/*/dist`; the coordinator rebuilds the bundles at integration.

Not run: `pnpm run build` (wave rule); a full suite or `squeal run --all` (worker rule; CI runs the full suite); `test/e2e/**` (outside Squeal, and no row file is an e2e path).
