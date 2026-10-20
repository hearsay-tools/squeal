# 012-01 brief: hook entries that stay harmless without their `args`

Approved by the human on 2026-10-20. Use /worker. Shape: slice.

Outcome: under Cursor CLI, which keeps an entry's `command` and drops its `args`, every Claude Code plugin hook runs nothing and exits 0. Claude Code still runs each one as it does today.

Read: 012 CC1, including its 2026-10-20 amendment; `research/cursor-dropped-args.md` and its probe; `../../001-core-loop/research/harness-process-liveness.md` on the exec form.

Seam: `plugins/claude-code/hooks/hooks.json`. Lead: every entry's `command` becomes one executable POSIX `sh` file of the plugin, kept outside `bin/`, for example `${CLAUDE_PLUGIN_ROOT}/hooks/run`. It exits 0 when it gets no arguments, before it reads anything. Otherwise the per-tool entries run today's `s()` test, and every entry ends in `exec "$@"`.

Owns: `hooks.json`, the new file (mode 755), `test/harness/fast-path.test.ts`, `test/harness/plugin.test.ts`, and one new test under `test/harness/`. Leave alone: `src/`, every `dist/` (no build), the other plugins, versions, and all of `docs/`.

Done when:
- The new test takes every entry and runs its `command` alone. It runs it through `sh -c` with the payload on stdin, then through the heredoc form, each with `CLAUDE_PLUGIN_ROOT` set, using the probe's `redirect-span.json` and a `$(touch <marker>)` payload. Each run exits 0, prints nothing, and leaves no marker.
- The existing fast-path cases still pass with `args`, 10 ms p95 included.

Verify with lint, typecheck and `squeal run --all --wait`, using `npx vitest run --maxWorkers=4` only without Squeal and saying which. Name any file that fails under load but passes alone. In the final message, give the p95 with the load it was measured at, and any decision this brief left open. Stop when it is committed on your branch.
