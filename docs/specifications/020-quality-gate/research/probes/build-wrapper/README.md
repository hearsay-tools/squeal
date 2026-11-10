# Probes for survey-020-16 (throwaway)

Throwaway. None of these ran: the one-minute load stayed above 24 (35 to 63) for the whole survey window. Each script refuses to run above 24 and records the load at its start and end. Each works in its own `mktemp -d` directory under `/tmp` with `HOME` and `TMPDIR` inside it, and nothing in this repository or in `~/projects/cezar` is written.

- `fixture/`: a tiny project shaped like cezar's package tests. `scripts/wrap.mjs` builds when stale, then runs `node --test`. `test/e2e/bin.test.mjs` has a helper `verify()` and starts the built `dist/tool.mjs` as a child. `test/unit/names.test.mjs` is a normal unit test.
- `whoami.cjs`: a preload that logs each Node process (pid, parent, argv, `NODE_TEST_CONTEXT`, whether `NODE_V8_COVERAGE` is set).
- `wrapper-inject.sh <squeal-worktree>` (Q1): runs `npm run test:package -- test/e2e/bin.test.mjs` plain, then with Squeal's `recorder.cjs` and `reporter.mjs` in `NODE_OPTIONS` and `NODE_V8_COVERAGE` set, with and without the wrapper's own `--test-reporter`, and with a forced build. It prints the processes, the coverage files with their sizes, the `own-<pid>` name, the event types and the wrapper's stdout.
- `gate-today.sh <squeal.mjs>` (Q2, Q3): temporary git repositories from the fixture, where the head edits `verify()`. Runs `squeal code --base HEAD~1 --json` (1) with only a `test/unit` node:test entry (expected: `no-loader`, exit 3; `--test` on the file exits 2), (2) with a `test/e2e` entry and no build (expected: `test-failed`), and (3) with the entry after a build by hand (expected: `verify` measured).
- `cezar-cost.sh <squeal.mjs>` (Q5): a `git clone --shared` of cezar at `c817e1302` in `/tmp`, with a copied `node_modules`. It times the wrapper cold and warm, then the gate on `binary-names.test.ts` with no entry and with a `test:package` entry. The test packs and installs the tarball, so npm needs the network.

To run them, with the CLI of a released Squeal (0.1.427 holds the gate):

    CLI=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.427/dist/cli/squeal.mjs
    sh wrapper-inject.sh <squeal-worktree> > wrapper-inject.out.txt 2>&1
    sh gate-today.sh "$CLI" > gate-today.out.txt 2>&1
    sh cezar-cost.sh "$CLI" > cezar-cost.out.txt 2>&1
