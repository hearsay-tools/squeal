# Probe: issue 46, a manual run tears down the slow tier's environment

Throwaway. Not product code, not a test of Squeal's suite. Findings: `../../issue-46.md`.

A synthetic, isolated fixture, not the original cezarion incident. `fixture/env-up.sh`
copies the one rule of cezarion's `.ai/scripts/test-env-up.sh` (at 2a5e7a7) that matters
here: reuse the running server when its descriptor is fresh (TTL) and its pid answers,
otherwise kill the recorded pid (`teardown_stale`) and cold-boot a new server on a free
port. `fixture/setup.ts` is the project's `globalSetup` and calls it, as cezarion's
`packages/web/e2e/environment.ts` does; its teardown stops nothing, as there.
`fixture/e2e/held.e2e.ts` reads the descriptor and polls the server for 8 s.

`run.sh <stale|fresh>` copies the fixture to a fresh `mktemp -d` git repository,
installs Vitest there (`node_modules` never enters this repository), runs
`squeal run --all --wait` in the background, and once the slow file has started runs
`npx vitest run e2e/held.e2e.ts` by hand (the `npm run test:e2e` analogue). `stale`
gives the env a 2 s TTL, so the manual run's setup kills the server; `fresh` gives it
600 s, the control. It then prints `squeal status`, `squeal status --json`'s known
failure and `squeal why`, asks `squeal retry --reason environment`, and cleans up: the
fixture's servers by pid, `squeal remove --config`, the temp directory. `HOME` is a
temp directory; the CLI is the installed plugin's 0.1.223, called by path.
