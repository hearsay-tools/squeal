# Throwaway probes: line-level selection (015-15 R1)

Research only. No product or live settings writes. Run from repository root at
`f1068562e8595a6da9fd79ff605e2eb3212585e5`. Python 3 standard library; Node
24.22.1, V8 13.6.233.17-node.58; installed tsx 4.23.15 and Vitest 5.0.3.
No dependency install is needed. Fixtures do not start Vitest or node:test.

## Reproduce from committed evidence

These commands use only the saved projections and Git history:

```sh
selection_probe=docs/specifications/015-coverage-complexity/research/probes/line-level-selection
python3 "$selection_probe/aggregate.py" "$selection_probe/snapshot.json.gz" "$selection_probe/comparison.json.gz" "$selection_probe/history.json.gz" "$selection_probe/outcomes.json.gz" "$selection_probe/fixtures.json"
python3 "$selection_probe/compare.py" "$selection_probe/snapshot.json.gz" "$PWD" 40 /tmp/line-selection-comparison.json.gz
```

Actual results: aggregate exits 0, all assertions pass (`audit.json`). Compare
exits 0; 40 commits, 97 edits, 53,073 file-edit pairs (`summary.json`). Elapsed
seconds vary. Neither command executes project tests. The aggregate checks all
selected old-source hashes and result/record times against the edit parent and
commit time, not only a sample. The commit-union calculation keeps a test if
**any** affected source lacks no-hit evidence. It does not reconstruct full keys.

## Commands used for fresh read-only acquisition

The following commands were executed with these arguments, using the expanded
paths shown by `selection_probe`. Repeating them reads a later live population;
it will not reproduce the original observation times. Preserve the committed
files when doing a new study. The scripts hard-select provider 2; they do not
silently adopt provider 3 after the repair.

```sh
selection_probe=docs/specifications/015-coverage-complexity/research/probes/line-level-selection
python3 "$selection_probe/snapshot.py" "$PWD" /home/agent/projects/squeal/.git/squeal "$selection_probe/snapshot.json.gz"
python3 "$selection_probe/compare.py" "$selection_probe/snapshot.json.gz" "$PWD" 40 "$selection_probe/comparison.json.gz" > "$selection_probe/summary.json"
nice -n 10 python3 "$selection_probe/history.py" "$selection_probe/snapshot.json.gz" "$selection_probe/comparison.json.gz" /home/agent/projects/squeal/.git/squeal "$PWD" "$selection_probe/history.json.gz" > "$selection_probe/history-summary.json"
python3 "$selection_probe/outcomes.py" "$selection_probe/history.json.gz" "$selection_probe/comparison.json.gz" /home/agent/projects/squeal/.git/squeal "$selection_probe/outcomes.json.gz" > "$selection_probe/outcomes-summary.json"
node --import tsx "$selection_probe/fixtures.mjs" > "$selection_probe/fixtures.json"
python3 "$selection_probe/aggregate.py" "$selection_probe/snapshot.json.gz" "$selection_probe/comparison.json.gz" "$selection_probe/history.json.gz" "$selection_probe/outcomes.json.gz" "$selection_probe/fixtures.json" > "$selection_probe/audit.json"
```

All exited 0. Actual readings:

| Command | Result |
| --- | --- |
| snapshot | 15:12:52–15:12:56 UTC; 3.51 s; 1,290 tracked, 1,270 included, 1,285 records; 57 current, 1,213 stale-only; zero missing manifest parts |
| compare | 22.04 s; 97 rows retained; all have file selectors; old-source matched no-hit 1 in this latest-record projection; new-source hindsight no-hit 7,206 |
| history | 15:20:23–15:24:30 UTC; 246.92 s, cap 300 s; all 1,270 files processed; 227,813 result keys visited; 90,333 records decoded; 11,348 old-source no-hit pairs before case qualification |
| outcomes | 15:25:09–15:25:10 UTC; 7,308 keys; 11,299 no-hit, 8,180 hit; 126 pairs have nonpassing cases, 108 skipped cases; no selected key's case rows postdate its commit |
| fixtures | 2.76 s; Node 24.22.1; starting load 11.39, 24 CPUs; all ten baselines pass; nine introduced failures, eight naive misses, one passing control |
| aggregate | Assertions pass; three single-source heuristic candidates, zero whole-source-commit heuristic candidates |

Stores use URI `mode=ro`, `PRAGMA query_only=1` and read transactions. The main
and code database transactions start separately; this is not an atomic snapshot
across both databases. The archive and case-outcome readings are later separate
snapshots, with their own times. Source bytes and exact identities, rather than
nearby record timestamps alone, decide source matches. SQLite databases, run
logs and credentials are not copied into the deliverables.

## Saved formats and interpretation

- `snapshot.json.gz`: configured tracked population, excluded paths, stored
  closure rows, current keys and latest retained coverage-bearing results.
  `records[key].record.sources` refers to `sourcePool` ids. Each pooled source
  retains path, blob, executable/covered little-endian base64 bitsets and function
  ranges. Ids hash the normalized JSON. Snapshot extraction checks each shared
  part's hash and path. Source objects were deduplicated before publication;
  the original snapshot time is preserved. All 1,285 selected records decode.
- `comparison.json.gz`: every `(commit, source)` edit, old/new source hashes,
  diff hunks, and each affected test-file pair. File selectors come from stored
  closure paths, not just sources seen in coverage. `old` and `new` are distinct.
  Old source absence, hash mismatch, skipped tests and insertions remain counts.
- `history.json.gz`: bounded search of retained results. Per test/edit, the first
  source-compatible record encountered in descending **result time**, with
  record and result times before the commit, is selected. This need not be the
  newest coverage timestamp. Multiple versions of a source can use different
  test keys. `sources` contains only the selected path/blob/bitsets. Provenance
  includes key, provider, run, result commit, dirty flag and times. Every selected
  entry states `wholePreEditKeyProven: false`. Historical runtime versions are
  unknown. Records from the affected node:test provider are not soundness proof.
- `outcomes.json.gz`: separate read of all case outcomes at the selected keys,
  including their timestamps. A file-level `pass` does not substitute for this
  read. Missing/later results, skipped cases and nonpassing cases retain tests.
- `fixtures.json`: complete before/after coverage and assertions for ten
  **adversarial** cases. Counts are not real-world miss rates. Fixtures are
  written to private temporary directories, run serially and removed. They
  check load before launch and each case; execution has a 20-second timeout.
  The stale case first changes a dependency and confirms a pass, then uses the
  older coverage to select the next edit. Reflection reads an unused body's
  text. Hoisting reads an uncalled function's arity. Child coverage is absent
  from its parent's record. All fixture source hashes are explicit.
- `audit.json`: accounting, three candidate keys/durations, union counts and
  adversarial results. Fixture fallback flags name their known hazards; they
  are not a general AST analysis. The historical heuristic uses only hunk shape
  and conservative lexical test-side closure signals. These are different
  exercises; neither proves safe skipping.

`history.py` decodes legacy full records and shared manifests. Manifest parts
use non-final byte-aligned deflate, so they are read with `decompressobj`.
Source identity uses Git blob hashes, and bit `line-1` denotes a covered line.
Pure deletion comparisons use the old lines. Additions with no old lines fall
back, unlike interpreting neighboring post-edit lines as pre-edit evidence.

## Bounded verification

Syntax/parse commands, all exit 0, are saved in `verification.txt`:

```sh
node --check docs/specifications/015-coverage-complexity/research/probes/line-level-selection/fixtures.mjs
python3 - <<'PY'
import ast, pathlib
for path in pathlib.Path('docs/specifications/015-coverage-complexity/research/probes/line-level-selection').glob('*.py'):
    ast.parse(path.read_text(), filename=str(path))
    print('PASS', path.name)
PY
git diff --check
```

The exact affected-status invocation was:

```sh
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/015-coverage-complexity/research/probes/line-level-selection/fixtures.mjs docs/specifications/015-coverage-complexity/research/probes/line-level-selection/snapshot.py docs/specifications/015-coverage-complexity/research/probes/line-level-selection/compare.py docs/specifications/015-coverage-complexity/research/probes/line-level-selection/history.py docs/specifications/015-coverage-complexity/research/probes/line-level-selection/outcomes.py
```

It exited 3: no test closure holds those research paths, two known node:test
failures, 1,213 of 1,270 test files unknown. Full output: `affected-status.txt`.
This is not a suite pass. No full-suite run, build or typecheck ran. Biome excludes
`docs`; Python parsing and `node --check` verify the probe syntax. The offline
audit verifies the numerical claims. No claim of provider-v3 verification,
prioritization benefit, actual skipped runs or net CPU savings is made.
