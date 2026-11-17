# Probes for 011-385 (throwaway)

Throwaway scripts for `research/unlisted-after-start.md`. They read logs, transcripts and run logs
read-only and write their output to stdout; keep that output in a scratch directory, not here.
`owed-delivery.ts` builds its own synthetic store under `$TMPDIR` and removes it.

| Script | What it reads | Output |
|---|---|---|
| `daemon-starts.cjs <logs-dir> [since]` | `~/projects/<repo>/.git/squeal/logs/daemon-*.log` | one JSON line per daemon pid: first line, listing commit (`commitFirst` long write), `serving`, busy waits and long writes before `serving`, stop |
| `stretches.cjs <since> <transcript-dir-prefix>...` | `~/.claude/projects/<prefix>*/*.jsonl` | one JSON line per transcript with an unlisted text: the stretch, hooks by outcome, tool batches, hand test runs, Squeal commands |
| `join.cjs <stretches> <starts>` | the two outputs above | one line per stretch with the daemon's listing time and the delivery delay after it |
| `summary.cjs <joined>...` | `join.cjs` output | medians and percentiles of section 1 |
| `hooks.cjs <run.ndjson> [from] [to]` | a decompressed Squawk run log | hook items with status and first text line |
| `transcript-hooks.cjs <transcript.jsonl>...` | Claude Code transcripts | hook attachments with duration and timeout |
| `boundary-durations.cjs <since> <prefix>` | Claude Code transcripts | PostToolBatch outcomes and durations by day |
| `owed-delivery.ts <src-root> <N,...>` | this worktree's source | time of the first delivery after the listing for a session registered before it, against ordinary ones (`NEWS=1` adds a transition to each) |

Commands as run, 2026-11-17 (scratch `S=$TMPDIR/u385`):

```sh
node daemon-starts.cjs ~/projects/cezar/.git/squeal/logs > $S/cezar-starts.ndjson
node stretches.cjs 2026-11-10 -home-agent-projects-cezar--ai-squawk-worktrees- > $S/cezar-stretches.ndjson
node join.cjs $S/cezar-stretches.ndjson $S/cezar-starts.ndjson > $S/cezar-joined.ndjson
node summary.cjs $S/cezar-joined.ndjson
# the same with squeal in place of cezar
NEWS=1 nice -n 10 ../../../../../../node_modules/.bin/tsx owed-delivery.ts "$(git rev-parse --show-toplevel)" 20000,50000,80000
```

Run `owed-delivery.ts` with the worktree's `node_modules/.bin/tsx`, never through `pnpm exec`.
