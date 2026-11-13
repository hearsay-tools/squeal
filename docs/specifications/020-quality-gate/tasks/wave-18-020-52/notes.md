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
