# 001-143 probes (throwaway)

Evidence for row 001-143, not product code; the write-up is the 2026-10-08
001-143 section of `../001-132/notes.md`. Run against a cezar clone at
`1c97556a` with `npm ci`, every command with each `CEZ_*` variable unset.

- `recorder/`: a copy of `src/runners/observe/` at `75c2fbf` whose
  `SQUEAL143_OFF` switches off one candidate each, or applies a candidate fix
  (`threadport`, `heldfd`); `SQUEAL143_TIME` times its appends.
- `two.ts`: one Vitest run of named files with a recorder variant, delivered as
  the adapter delivers it; `stamp.cjs` times every worker and child.
- `rounds.sh`, `arm.sh`: rotated rounds of variants, without and with at most 8
  busy loops; `analyze.mjs` summarizes them.
- `child.sh`: the `--help` child alone per variant; `append.mjs`: a write's
  latency on a filesystem; `prof.mjs`, `stacks.mjs`: read a V8 CPU profile.
