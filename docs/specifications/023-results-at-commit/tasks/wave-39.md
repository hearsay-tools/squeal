# Wave 39 (row 023-85): certify a first-seen absent path from the run's own read. Use /worker.

The human chose (2026-11-24): drop candidate 0.1.618 (row 023-81, review `reviews/0.1.618.md` FAIL) and fix round 11's measured re-run cost from the run's own reads ("Drop + read-based fix"); rows 023-83 and 023-84 and round 12 follow. The base is main (0.1.616, unreleased, on 0.1.615).

Read `tasks/023-81-notes.md` (the probe table, "why files ran twice", B's stop and the paragraph on the recorder's read outcome), `reviews/0.1.618.md` (why write attempts were not proof; the same care applies to reads), `src/core/scheduler/observed.ts` (`firstSeen`, its comment citing review wave 12d B1 and task 001-134) and the recorder (`src/runners/observe/fs.cjs`, `src/runners/observe/inputs.ts`), and `../lessons.md` round 11. Never write the lab VM host name, the company name, sandbox ids or home paths in committed files (`pnpm run check:private` with `set -o pipefail`; also grep your diff). Host is shared: direct vitest only with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; no full suite; no version, no build; nothing left running; wait only on your own jobs.

## The cost

On an empty store, a test whose run first reads a path that does not exist (a config probe such as `test/deno.json`, `.postcssrc*`, an unbuilt `.wasm`, squawk's `.ai/ast-grep/rules/*.baseline.json`) is `firstSeen` and runs again. Round 11: 48 of 226 folder-listing tests in this repository and squawk's two lint files on each side; every dogfood session paid it.

## The rule to implement

A path in `firstSeen` certifies the run's result without a re-run when all hold:

1. the recorder recorded that **every** read of that path in the run found it absent (ENOENT or ENOTDIR from stat, lstat, access, open, readFile, readdir, existsSync false, and the other wrappers the recorder has), with no read that found it present;
2. the run recorded no write, create, rename or remove of that path or below it (attempts count: a failed write still disqualifies);
3. the path is absent when the daemon hashes it after the run;
4. it is not git-ignored (ignored absent paths keep today's rule);
5. no revision during the run names it.

If the recorder cannot tell an absent read from a present one for some wrapper, that read disqualifies. Record the read outcome additively (for example `ObservedInputs.absent`, paths every read found absent). A path whose reads the recorder did not see at all keeps today's rule.

Why this is sound where the watcher was not: the result depends on what the run read. If every read found the path absent and it is absent now, the key over "absent" describes what the run saw, whatever happened between reads. Think through and test the cases where this argument fails (a read through a symlink whose target appears, a directory read vs a file read, case-insensitive names, a path read by a child process the recorder does not see), and refuse to certify in each.

## Tests

Each fails without the fix: a test that probes an absent config path runs once on an empty store, not twice; the same with the path read by two different wrappers. Each must keep today's re-run: a path present at one read and absent at another; a path the run wrote or tried to write; a path present at run end; an ignored absent path; a revision naming the path during the run; a read the recorder did not see (a child process without the recorder). Measure: first-run re-runs on an empty store in this repository (the 48 of 226) and on squawk's lint files, before and after; put both in the notes.

## Versions

If `RECORDER_VERSION` or `KEY_FORMAT_VERSION` must rise, send the coordinator a request first and stop until the reply (a raise re-runs users' tests; the human decides). If an additive recorder field trips the key-format alarm as in wave 38, propose how to treat it in the request.

## Ownership

`src/runners/observe/**`, `src/core/scheduler/observed.ts` and the store decision for first-seen, `src/core/keys/**` if needed, tests beside them. Ask before editing other scheduler, daemon or CLI files.

## Done when

Tests fail without the fix; lint, typecheck, check:private; `squeal status --wait 60000 <changed paths>`; run `test/keys/*.test.ts`, the observe and recorder tests, `test/scheduler/*first*` / `*observed*` tests and `test/cli/status-at*.test.ts` directly; measurements in `tasks/023-85-notes.md`.
