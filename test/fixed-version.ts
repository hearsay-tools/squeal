/*
 * Row 011-425: the Squeal version this repository's own tests report, so a
 * raise of the root `package.json` re-keys only the tests that read the real
 * version on purpose (the bundle, plugin and release checks), not every test
 * that runs Squeal from source.
 *
 * Squeal from source reads the nearest `package.json` named `squeal` unless a
 * build defined `__SQUEAL_VERSION__` (`squealVersion`,
 * `src/core/daemon/version.ts`). The tests define it: Vitest's `define` in
 * the workers (`vitest.config.ts`); the manifest `buildCli` writes beside its
 * build (`test/daemon/helpers.ts`); `VERSION_ARGS` in the Node arguments of
 * the helpers that start Squeal from the sources beside a daemon in the
 * worker (`test/runner-host/process-helpers.ts`) and the `--run` child of the
 * `status --at` tests (`RELAUNCH`, `test/cli/status-at-kit.ts`); and the
 * bundle of `test/runner-host/remote/helpers.ts`. Not through `NODE_OPTIONS`: Squeal
 * reads that variable in the projects it runs, and its daemons under test
 * would report the extra loader. Any other process started from the sources
 * reads the real version.
 *
 * The value is fixed: it need not follow releases. It sits between the older
 * versions tests write (up to `0.1.451`) and the newer ones (`0.1.899` up). It
 * differed from the real version (0.1.591) when it was set, so a test that
 * mixed the two failed then, not at a later raise.
 */
export const TEST_VERSION = "0.1.600";

/** Node arguments that give a process `TEST_VERSION` as a build would: no file, no read. */
export const VERSION_ARGS: readonly string[] = [
  "--import",
  `data:text/javascript,globalThis.__SQUEAL_VERSION__='${TEST_VERSION}'`,
];
