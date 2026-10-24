# Probe: check-protocol (016-03)

**Throwaway.** Evidence for `../../check-protocol.md`, not product code. No package was installed; nothing here runs in the suite.

## What it shows

1. `convert.mjs` turns three real outputs into Squeal's `RunReport` shape (`src/core/types/runner.ts`) and prints what each format lacks (Q5).
   - `out/node-tap.txt`, `out/node-junit.xml`: Node v24.21.0 `node --test --test-reporter=tap|junit` over `fixture-node/` (one file with a pass, a fail, a skip and two tests both named `adds`; one file whose import fails). Run in a scratch directory under `/tmp` with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there; the scratch path reads `<scratch>`.
   - `go-samples/*.json`: real `go test -json` streams from Go's own test data, `src/cmd/internal/test2json/testdata/` at golang/go `1fce9bafb0581a5d894b80d91674659854104012` (no Go toolchain on this host). They carry no `Package` field because test2json ran without `-p`.
   - `out/report-*.json`: the converted reports and the `missing` list.
2. `diag-identity.mjs` compares two Biome 2.5.15 SARIF runs of `fixture-diag/a.ts` before and after one comment line is added at the top (`a-edited.ts`) (Q3). `out/diag-identity.txt` is its output. `out/tsc-d*.txt` is `tsc --noEmit --pretty false --strict` (TypeScript 7.0.2) on the same two files; `out/biome-d*.rdjson.json` is Biome's rdjson reporter.

## Rerun

```sh
node convert.mjs tap out/node-tap.txt p math-cases.mjs broken-import.mjs
node convert.mjs junit out/node-junit.xml p math-cases.mjs broken-import.mjs
node convert.mjs gojson go-samples/timeout.json p example.com/pkg
node diag-identity.mjs out/biome-d1.sarif.json fixture-diag/a.ts out/biome-d2.sarif.json fixture-diag/a-edited.ts
```

The fixture files are not named `*.test.*` so that no runner of this repository collects them.
