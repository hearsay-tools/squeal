# 011-86 notes: one Node floor, 22.19

Worker c0e11c37, brief W2 of `tasks/wave-10.md`, base main at ed5423b04. Row 011-86 was not on the board at the base; the work follows the brief.

## Where the floor lives now

- **Source:** `package.json` `engines.node`, `>=22.19`. `package-lock.json`'s root entry mirrors it (this one line re-keys the suite once).
- **Build:** `nodeFloor()` in `src/harness/build.ts` reads it and throws on any shape but `>=<major>.<minor>`. Both builds use it for esbuild's `target` (`node22.19`) and for a `__SQUEAL_NODE_FLOOR__` define (`bundleOptions`, `pluginBundleOptions`).
- **OpenCode plugin:** `minimumNode()` in `src/harness/opencode/host.ts` takes the define. Under `tsc` and Vitest it reads the root `package.json` (`../../../package.json` from the module, the same in `src/` and `dist/`). It reads once, at first use, never at import. The CLI imports this module for `usesSquealAt` alone, and the daemon tests' `buildAt` copies the `tsc` build beside a `package.json` that names only a version. A read at import threw there, and no daemon served: handover, handover-gap, step-down and step-down-lanes failed with "serving not met in 60000 ms" (fixed in 208801a86). `NO_NODE_LOG` in `plugin.ts` names `minimumNode()`. Only the plugin entry and the tests load `plugin.ts`.
- **Shell:** `NODE_FLOOR=22.19` near the top of `install.sh` and of each `plugins/*/bin/squeal-launcher` (the four stay byte-identical). `install.sh` passes the output of `node --version` and `$NODE_FLOOR` to its comparison as arguments, so the version it compares is the version its failure names. The install-sh test fakes only `--version` and runs the real Node for the rest.
- **CI:** `node-version: "22.19"` in the `node22` job, literal.
- **Words:** `README.md` and the Claude Code, Codex and OpenCode plugin READMEs say 22.19.

## The guard

`test/node-floor.test.ts` scans `README.md`, `plugins/*/README.md`, `install.sh`, `plugins/*/bin/squeal-launcher`, `src/` (not `.wasm`) and `ci.yml`. It looks for these floor phrasings: "Node X or later/newer", "Node of at least X", "at least Node X", `nodeX.Y`, `NODE_FLOOR=X`, and a setup-node `node-version` in the floor's major. A file that states a version other than the floor fails, and so does any floor in `src/`. Each failure names the file and line. A fact about one version does not match ("Node 22.13 opens no SQLite URI", "needs Node 22.16", "Node 24.20 and later"). The README, `install.sh`, CI and the four launchers must each state the floor at least once.

Red step, with only `engines.node` raised to `>=22.19`: 14 places listed (`ci.yml:45`, `README.md:20`, `install.sh:76` and `:78`, three plugin READMEs, four launchers, `src/harness/build.ts`, `src/harness/opencode/build.ts`, `src/harness/opencode/plugin.ts`). At the base floor it already listed CI's bare `22` and the three `src/` literals. The `[22, 13]` tuple in `host.ts` was outside the phrasings. It is gone: `minimumNode()` reads the floor.

## Key validity (agreed with the coordinator)

- `test/keys/validity/bundle.ts` `targetOf` takes the literal `target:` a tree's build holds (every release to 0.1.245). Otherwise it takes `node` and that tree's `engines.node` floor through `nodeFloor(text)`. The fallback to the checkout's own target is gone.
- `test/keys/key-format.test.ts`: the target alarm case now edits `engines.node` (`>=16.0`), and every component fires. A new case raises `version` and changes `description`, and no component fires.
- **Comparison against the last release:** the checkout (node22.19) against `squeal--v0.1.245` (node22.13) fires no component's alarm (global, vitest, node:test, pytest, recorder: all `false`). The emitted code is the same, so the key format and the adapter versions do not move.

## Left for others

- **Bundles:** only `plugins/opencode/dist/plugin.mjs` drifts: `minimumNode()` with the floor `"22.19"` and the new log line (checked by building the OpenCode dist into a temp directory and comparing). The CLI bundles and the Claude Code, Codex and Pi plugins build byte-identical. The CLI imports nothing that reads the floor, so esbuild drops it, and the `node22.19` target emits the same code as `node22.13`. The coordinator rebuilds the OpenCode bundle, and that change needs a version raise.
- **Specs and decisions** still say 22.13: 001 spec line 153, 003 line 70, 005 line 71, 010 D4 line 55, 011 lines 206 and 211, `docs/decisions/0002-content-keyed-shared-store.md` line 29.
- **Launcher format** stays 4. Installed launchers keep "22.13" in their no-node message until a later format raise; the message shows only when no `node` is on the PATH.
- **Not changed, outside the scan:** `test/evals/squeal-refusals.test.ts` `LAUNCHER_NODE` is sample launcher output; the grader matches any version. `test/fixtures/{opencode,pi}/launcher-0.1.17x` are copies of old launchers. `test/helpers/pi.ts` keeps Pi's own `[22, 19]`.
- **Possible follow-ups the floor now allows:** `src/core/store/connection.ts:158` drops a "no transaction is active" error because "`isTransaction` needs Node 22.16". `src/core/slow/slot.ts:156` (and spec 011 line 206) copies a permit file because "Node 22.13 opens no SQLite URI". At 22.19 both may be simpler. Each needs a row and a check on 22.19.
