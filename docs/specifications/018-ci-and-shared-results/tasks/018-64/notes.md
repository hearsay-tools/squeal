# Row 018-64 notes: `squeal code --base --parts` uses the D33 rule

## Open question 2 of the fourth slice, closed

"Whether the gate (`squeal code --base --parts`) uses the rule as is.
`FileReuse` is shared, so it does unless the review finds a difference."

**Answer: yes, it does, once the gate passes the commit's tree.** The rule
lived whole in `FileReuse` since row 018-58; the gate only lacked the tree.
`partsEvidence` (`src/core/code/gate/parts.ts`) now builds its `FileReuse`
with `ReuseOptions.atCommit`, reading the part's `header.commit` tree
through `atCommit` (`src/core/ci/inputs.ts`, 018-57), as `ci export` does
(`export-inputs.ts`'s `treeAt`: `null` when git cannot read the tree, so
D9's rule alone applies). No reader difference was found beyond the ones
`reuse.ts` already names (`records`, and `here`: the gate hashes the bytes
on disk, the export reads its job's stat cache), so none was added.

Two readings of D33.4 that the gate settles by its place:

- "in the export checkout" is, for the gate, the content **here**: the
  worktree's bytes on disk when the gate runs, which is what the gate's
  `here` already hashes for D9.
- the endpoints count stays an export-only report line. The gate's report
  keeps row 020-49's refusals; an input certified by the rule is simply
  certified, and a file refused by it says `ends` like the export's.

## The change

- `src/core/code/gate/parts.ts`: `new FileReuse(parts, { records,
  atCommit: (commit) => treeAt(root, commit) })`, with a private `treeAt`
  (the same four lines `export-inputs.ts` has; a later quality pass could
  lift one copy into `inputs.ts`, beside `atCommit` itself — not done here
  to keep this row inside its ownership). `FileReuse` reads the tree once
  per commit, only when a part of format 6 has a commit and `touched`.

## Tests

`test/code/gate/parts.test.ts`, "an input nothing touched (018 D33, row
018-64)": a format 6 part of the fixture repo's own HEAD commit that read
its closure and nothing else (`data/x.txt` an observed input with no
read-time evidence, `stable: {}`, `touched: []`).

- Equal at both ends and here: the file is taken (red before the change:
  "its part holds no evidence of it").
- The input changed here after the commit: the file is refused with reason
  `input`, input `data/x.txt`, detail "its content at both ends of the
  part's command is not its content here".

`FileReuse` itself keeps row 018-58's tests (`test/ci/reuse-endpoints.test.ts`),
including the case this row removes the reason for: "does not apply without
the commit's tree: the gate's reading until it passes one" — the gate now
passes one, and that test names the option's absence, which stays true for
a reader that passes none.
