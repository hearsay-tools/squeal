# Probes for row 020-38 (reuse where no daemon ever ran)

Throwaway. Kept only as the evidence behind `../../no-daemon-reuse.md`. Nothing here is product code or a test.

Released Squeal **0.1.451**, a copy of the Claude Code plugin cache (`~/.claude/plugins/cache/hearsay/squeal/0.1.451`) at `/tmp/ndr/squeal-0.1.451`, run as `node dist/cli/squeal.mjs`. Node v26.13.0. Every Squeal call runs under `env -i` with `HOME=/tmp/ndr/home`, `TMPDIR=/tmp/ndr/tmp`, a `PATH` without `~/.local/bin`, at `nice 10` on 8 vCPUs (`taskset -c 0-7`; Node and Vitest size their pools from the affinity, so the gate ran at most 7 files at once). Each step starts only below a one-minute load of 24 (`guard.sh`).

## Setup (2026-11-12, by hand)

```sh
mkdir -p /tmp/ndr/home /tmp/ndr/tmp /tmp/ndr/out
cp -a ~/.claude/plugins/cache/hearsay/squeal/0.1.451 /tmp/ndr/squeal-0.1.451
for c in A B; do
  git clone -q --no-local <worktree> /tmp/ndr/$c && git -C /tmp/ndr/$c checkout -q 93e3e65cd
  cp -a <worktree>/node_modules /tmp/ndr/$c/node_modules    # no hard links across devices here
done
```

Both clones are this repository at `93e3e65cd`, with no store (`.git/squeal` absent). The edit (`env.sh`, `edit`) appends one function to `src/core/code/gate/estimate.ts`; both clones get the same diff (md5 `bbbe7f0a…`). `squeal code --base HEAD` then selects 160 Vitest test files (`out/dry-A0.*`, a 1 s budget run that ran nothing).

## Steps (`steps.sh <step>`, outputs in `/tmp/ndr/out`, copied to `out/`)

| Step | Clone | What | Output |
|---|---|---|---|
| (edit A) | A | `edit /tmp/ndr/A` | |
| `a1` | A | first `squeal code --base HEAD --json` | `A1.json`, `A1.err` |
| `a2` | A | second run, same bytes | `A2.json`, `A2.err` |
| `b-daemon` | B, unedited | `squeal start`; `squeal run tests <the 160 files A1 selected> --wait`; `squeal stop` | `B0.err`, `B0.out` |
| `b-edit` | B | the same edit | |
| `b1`, `b2` | B | two gate runs, same bytes | `B1.*`, `B2.*` |

Counts, all read-only on the stores:

- `summarize.mjs [--observed <store>] <out> <names>`: per report, files read from the stores and files run (`runs[].from`), wall time. Output `out/summary.jsonl`.
- `kept-count.cjs <store>`: test files with results, result keys, observed meta rows. Output in `out/stores.txt`.
- `reruns-vs-observed.cjs <store> <report>`: the files a report ran against the files the store's `observed.` row names. Output in `out/stores.txt`.
- `selected-observed.cjs <store> <report>`: how many selected files a store's `observed.` row names; run on this checkout's store (`/home/agent/projects/squeal/.git/squeal/store.sqlite`, read-only). Output in `out/stores.txt`.
- `repo-observed.cjs <store> <checkout>`: the entries of a store's `observed.` row, and those whose test file exists in the checkout. Output in `out/stores.txt`.
- `meta-write.mjs <store> <scratch>`: copies the three `observed*.` rows of a store (read-only) into a scratch SQLite file in WAL mode, `synchronous=NORMAL`, and times 15 merge writes of each, as `SharedPaths.write` does them. Run on this checkout's store. Output `out/meta-write-main.json`.

Cleanup: `rm -rf /tmp/ndr` (no daemon runs there; `b-daemon` stops its own).
