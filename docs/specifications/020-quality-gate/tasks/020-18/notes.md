# 020-18 notes: the functions left out (D16, #177)

Worker notes for whoever continues the row or reviews it.

## Seam map

- `src/core/code/gate/changed.ts` `changedFunctions`: the `atBase.has(count.bodyHash)` skip now keeps each skipped head function by path (`skipped`). After the loop, `omittedFunctions` (new `omitted.ts`) picks the ones a changed line touches. `changedPaths` also returns the untracked set.
- `src/core/code/gate/omitted.ts`:
  - Changed lines: one `git --literal-pathspecs diff -U0 --inter-hunk-context=0 --no-color --no-ext-diff --no-textconv --text --no-renames <base> -- <path>` per counted path that has a skipped function. Only the `@@ -a,b +c,d @@` headers are read, so path quoting does not matter. `--inter-hunk-context=0` matters: a user's `diff.interHunkContext` joins hunks over untouched functions (a test proves it).
  - An untracked path: every line is changed, with no git call. A path added with `git add -N` goes through the diff and reads the same.
  - Touch: a hunk with lines touches a function whose range holds one of them. A pure removal (`+c,0`) sits between head lines c and c+1; it touches a function that holds both (a blank line removed inside it), not one that ends at c or starts at c+1.
  - Reason: `unchanged` when the base path holds the same qualified name, occurrence and body hash; else `moved`. `base` is the first base function with the hash, by path, name and occurrence, over the counted changed paths at the base (the same set D2 skips by).
  - `byIdentity` is the sort, used by `changedFunctions` and again by `evaluate`, so the same inputs in any order give the same report.
- `types.ts`: `OmitReason`, `OmittedFunction`, `ChangedSet.omitted?` (optional, additive).
- `report.ts`: `GateReport.omitted?`, after `functions`. `evaluate.ts` passes it, sorted, when the inventory gave it. So the CLI always writes `omitted` (`[]` when none); a hand-built ChangedSet without it gives a report without it, as before.
- `src/cli/code-gate-text.ts`: `omittedText` ends the verdict line. 020-15b owns the rest of the file.
- `src/cli/code-gate.ts` `narrow()`: one line narrows `omitted` to the paths (parent agreement, request f72362cf).

## Decisions the spec did not settle

1. Each entry also has `occurrence` and `line`. D16.2 names path, qualified name and reason. Test callbacks share one name (`<describe>.<it>`), so without the occurrence two entries can read the same; `line` lets a reader find it.
2. The base match is named `base`, with `path`, `qualifiedName` and `occurrence`. With several base functions holding the body, it is the first by path, name and occurrence.
3. The text says "moved or unchanged" whatever the reasons present, as D16.3's example.
4. A skipped function inside a parse-error range is listed too: D2 does not judge it, and a changed line can touch it.

## Not done here

- D16.5, whether a copied body at a new identity should be judged, is still open.
- Bundles (`plugins/*/dist`) and `plugins/codex-runtime/runtime.json` are not rebuilt; the row does not own them. The baseline already drifted: its `src` changed after the last bundle commit (`ec095ee30`), and `ba819d9e4` changed `commands.md` without the manifest. `test/harness/pi/package.test.ts` (bundle differs from the build) and `test/harness/codex/runtime-release/limits.test.ts` (`commands.md` sha256) fail for that reason; the next bundle commit fixes both.
