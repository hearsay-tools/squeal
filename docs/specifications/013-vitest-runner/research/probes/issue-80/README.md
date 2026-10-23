# Issue 80 throwaway probe

This fixture is research evidence, not a product regression test. Each run creates a private Git repository under the runtime directory, runs one foreground Squeal daemon there, and stops only that daemon. It leaves the fixture for inspection. `.runtime/`, `.runtime-*/` and all `node_modules` are out of Git. No other daemon, worktree or Cezar server is started or stopped.

The fixture has five test files, one per case. Each test imports `./scroller`, which at first imports nothing. The cases:

- A: write `navigation`, let the revision settle, then edit `scroller` to import `./navigation` (the issue's order).
- B: write `navigation` and the `scroller` edit in one burst.
- C: edit `scroller` to import the missing `./navigation`, run, then create `navigation`.
- D: write the `scroller` edit 200 ms before `navigation` in one burst.
- E: as C, but ask for `squeal run --all --wait` right after the create, then settle and ask again.

"Settle" is a 1.5 s pause and then `squeal status --wait 60000`. Layouts: `single` (root config, Node environment, `.ts`), `projects` (root `test.projects: ['packages/web']`, Node environment), `web` (the same projects layout, `environment: 'jsdom'`, `.tsx` sources: the shape of cezarion's `packages/web`). After the cases, a cold `vitest run` of the same fixture is the comparison. The script refuses live reproduction when the one-minute load exceeds the CPU count.

Commands, run from this directory on 2026-10-23 UTC:

```sh
npm install --prefix .runtime --no-audit --no-fund --ignore-scripts vitest@5.0.3 vite@8.3.2 jsdom   # jsdom resolved 30.1.3
npm install --prefix .runtime-v4 --no-audit --no-fund --ignore-scripts vitest@4.1.10 vite@8.1.4 jsdom@29.1.1
C=/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.276/dist/cli/squeal.mjs
for l in single projects web; do node probe.mjs $C $l > output-$l.txt 2>&1; done
for l in web projects single; do node probe.mjs $C $l .runtime-v4 > output-v4-$l.txt 2>&1; done
```

`.runtime-v4` pins the versions installed in the cezarion checkout at `/home/agent/projects/cezar` (565fd3eaf): Vitest 4.1.10, Vite 8.1.4 and jsdom 29.1.1 for `packages/web`. Squeal loads the Vitest of the repository it serves. `output-*.txt` are the complete captured runs. `source-evidence.txt` holds short source extracts. An exit code of 0 for the script means it ran, not that the defect reproduced; read the `VERDICTS` line (0 pass, 1 known failures, 3 no verdict).

`watch-check.mjs` starts Vitest with `watch: false`, as Squeal does, in a leftover `web` fixture of each runtime and prints `server.watch` of the root and each project server. It was copied into each runtime directory so that `vitest/node` resolves from there, run from the fixture as `node ../watch-check.mjs "$PWD"`, and its output saved to `watch-check-output.txt`.
