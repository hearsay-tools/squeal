# Probes for `issue-10.md`

Throwaway. Not product code, not tested, kept as the record of how the findings were measured. Nothing here is imported by Squeal. Each fixture is its own Git repository, so its Squeal store (`<fixture>/.git/squeal/store.sqlite`) is separate from every real one.

- `make-fixture.sh <dir> [lookup-only|lookup-then-run-missing]`: a cezar-shaped fixture. It has a `web` Vitest project (`packages/web`, `src/**/*.test.{ts,tsx}`) with six unit tests and an import-free helper, `src/lib/nav-contract.ts`. It has a slow `e2e` project (root `packages/web/e2e`, `slow.include` `packages/web/e2e/*.e2e.ts`, `inputs` `packages/web/src/**` and `packages/web/e2e/**`, as cezar declares them) with one 3 s file that imports the helper. It also has a module with its own unit test (`src/lib/backdrop*.ts`), and 50 committed files under `packages/server/dist` that stand in for build output. It runs `npm install` for vitest 4.1.12 and commits. The helper's unit test first sleeps for `UNIT_SLEEP_MS` from the daemon's environment.
- `move-helper.sh <dir> [full|none]`: the reporter's edit in one step. It moves the helper unchanged to `e2e/` and updates both importers. `full` also deletes `backdrop.ts` and its test, as the reporter's script did. `none` moves nothing and only appends a comment to the unit test.
- `rebuild.sh <dir> [n]`: rewrites every `packages/server/dist` file with its own bytes `n` times, 1 s apart. This stands in for a build that rewrites its output unchanged, which is a watcher touch with no revision (D2, task 001-159).
- `drive-touch.sh <dir> <squeal.mjs> [full|none]`: runs the edit. Once `status --json` shows a test file running, it calls `rebuild.sh <dir> 1`, then `status --wait 60000 packages/web/src/lib/nav-contract.test.ts`.
- `file-state.sh <dir> <squeal.mjs>`: prints the edited unit test's row from `status --json`: revision, file-level passes, and its `unknownTestFiles` entry.

The runs used pinned CLIs: 0.1.199 at `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs`, and HEAD as this branch's committed `plugins/claude-code/dist/cli/squeal.mjs` (0.1.200, bundle last built at 30ec91a2, main 25d65b2d). Each daemon was started with `UNIT_SLEEP_MS=4000 node <cli> start .` (unset for `a199` and `b199`) and stopped with `node <cli> stop <dir>`. The fixtures lived under `.ai/cezar/t/44230d34/` and were removed afterwards.

## Replay commands

From the Squeal checkout, using an absolute installed CLI path for `issue10_cli`:

```sh
issue10_probe="$PWD/docs/specifications/001-core-loop/research/probes/issue-10"
issue10_cli="$PWD/plugins/claude-code/dist/cli/squeal.mjs"
issue10_fixture=$(mktemp -d /tmp/squeal-issue10.XXXXXX)
"$issue10_probe/make-fixture.sh" "$issue10_fixture" lookup-only
(cd "$issue10_fixture" && UNIT_SLEEP_MS=4000 node "$issue10_cli" start .)
"$issue10_probe/drive-touch.sh" "$issue10_fixture" "$issue10_cli" full
"$issue10_probe/file-state.sh" "$issue10_fixture" "$issue10_cli"
node "$issue10_cli" stop "$issue10_fixture"
rm -rf -- "$issue10_fixture"
```

Expected affected unit file: unknown with the same-bytes-write reason, no queued run. For the move-only control, use a fresh fixture and replace `drive-touch.sh` with `move-helper.sh`, then the named status wait. The wait can also select the slow e2e file via its declared inputs; inspect the unit file's own state to distinguish that pending slow file from this defect. The commands above consolidate the recorded probe path; the research table records the actual runs.
