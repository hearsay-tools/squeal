# 020-20 notes: the gate certifies a part's inputs as the record path keys them

Worker notes for whoever continues the row or reviews it.

## What reproduced, and what did not

- **The symlink case in the brief passes before the change.** `test/cli/code-gate-parts-link.test.ts` reads `data.json` (a file link to `fixtures/data.json`) and `linked/data.json` (`linked` a directory link to `fixtures`), changes the target after `ci record`, and expects both files to run. They ran at the base commit too, for two reasons:
  - The run-time recorder (`src/runners/observe/recorder.cjs`, task 001-135) records a read's target when `realpath` resolves it, so the part's `observed.paths` holds `fixtures/data.json`. `ci record`'s evidence (`src/runners/vitest/ci-runtime/evidence.cjs`, `read`) records the target's content too.
  - `hashFile` follows a directory link, so `linked/data.json` changes with its target.
  The test stays as the done-when's end-to-end check.
- **`linkTargets` (`scheduler/link-target.ts`) adds a target only for a file that is absent at read time**: `realpath` of the file fails, so neither the recorder nor `evidence.cjs` names the target. The daemon keys it; the gate did not. With the shared rule the gate now runs such a file, because the part's evidence lacks the target. `ci export` already refused it in the same way (`certifier` over the keyed closure). This is safe (less reuse, no false pass). Pinned in `test/code/gate/parts.test.ts`, "certifies a path read through a directory link with its target".
- **A real false take reproduced: the recursive listing's source.** The gate listed the directories below a recursive listing from tracked files only (`git ls-files`). The daemon lists files git does not ignore (`WorktreeKeys.bootstrap`: `--cached --others --exclude-standard`, through `Listings`). A directory below that holds only untracked files was keyed by the daemon and not certified by the gate: a new file in it after `ci record` left the file taken. Red then green in `test/code/gate/parts.test.ts`, "certifies the listing of a directory below that holds untracked files only".
- **`observed.modules`**: the gate added it to its inputs; `observedGrowth` does not. The recorder writes each module load to `f` (paths) as well as `m` (`recorder.cjs`, `load`), so modules are always among paths. Dropping the term changes nothing.

## Seam map

- `src/core/scheduler/observed.ts`:
  - `inputsOfReads(root, reads, below)`: the one rule. Per read: paths beyond the closure, their link targets, the listings (`below` for a recursive one), minus the run's scratch. One `checkIgnored` call for all reads; returns `inputs` per read and `ignored`.
  - `observedGrowth` calls it with `keys.listingsBelow`; it calls `keys.listedByRun` for every read first (it changes `Listings.#seen`, which `below` does not read, so the order is equal to the old one).
  - Named `inputsOfReads` because `src/runners/observe/inputs.ts` already has an `observedInputs`, which builds `ObservedInputs`.
  - `below` is required on purpose. `test/keys/validity/entries/global.ts` re-exports this whole module into the key bundle, so code only the gate runs must not live here: `key-format.test.ts` would need validity cases for lines the daemon never runs. Also, `below ?? (await ...)` left V8 a never-run continuation range over the next lines.
- `src/core/ci/inputs.ts`:
  - `hereOf(root, file)`: an input's content here as a key holds it (listing names on disk, `.git` by kind, a file by `file`). `certifier` passes the stat cache; the gate passes `hashFile`.
  - `inputsOfReadsHere(root, reads)` and `listingsBelowHere(root, directories)`: the gate's `below`, a `Listings` over `git ls-files --cached --others --exclude-standard` minus `--deleted`, scoped to the recursive directories. No git call when no listing is recursive.
- `src/core/code/gate/parts.ts`: `partsEvidence` now collects candidates (owner, environment check, closure) first, then calls `inputsOfReadsHere` once for all of them, then certifies each. `contentHere` memoises `hereOf` per path. No listing, `.git` or `ls-files` code is left in the file.
- `src/core/ci/export-inputs.ts`: `certifier` uses `hereOf`.

## Tests

- `test/cli/code-gate-parts-link.test.ts` (new, end to end, about 15 s): taken while the target is unchanged; both files run after it changed.
- `test/code/gate/parts.test.ts`: two new cases (link target, untracked listing). 297 lines.
- `test/ci/inputs-here.test.ts` (new): `listingsBelowHere` (untracked counted, ignored and deleted not) and `inputsOfReadsHere`.
- `test/keys/validity/cases/listing/recursive.ts` (new case): a recursive listing, a read through a directory link and the run's scratch through `observedGrowth`. No case ran a recursive listing before, so the moved lines had no case. The assemble harness (`harness/assemble.ts`) and `case.ts` gained optional `directories`, `recursive` and `written` on `freshObserved`. Keys equal the release's.

## Decisions the spec did not settle

- The gate refuses a file whose read through a directory link found no file (no evidence of the target), as `ci export` does. Default taken; it is fail-safe.
- The gate's recursive listing source follows the daemon (untracked files count, deleted ones do not) rather than tracked files only.
- `listingsBelowHere` lives in `ci/inputs.ts`, not `scheduler/observed.ts`, to keep it out of the key bundle.

## Left for later

- A dangling file link (a link whose target does not exist at read time, then created) keys by its link text in both the daemon and the gate; neither names the target. Not this row's: both paths agree.
- `plugins/*` bundles drift until a build; this row does not own them.
