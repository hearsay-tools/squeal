import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { currentUid, userTmpDir } from "../src/core/daemon/paths.js";
import { pidNamespace } from "../src/core/delivery/harness-process.js";
import {
  entryUnder,
  findProcesses,
  isAlive,
  killProcesses,
  ownerOf,
  type Stray,
  TEST_CACHE,
} from "./daemon/strays.js";

/*
 * Lessons, defect 29 (task 001-138): no daemon Squeal's own tests start
 * outlives the run. Setup gives the run its own directory under the test
 * cache, where `test/daemon/helpers.ts` builds the CLI; teardown kills
 * whatever still runs from that directory and fails the run, naming the test
 * files that left it. Runs whose Vitest process is gone (killed before its
 * teardown) are swept at the next setup, without failing this one.
 *
 * Task 014-36: the run's temp directories go the same way. Setup points
 * `TMPDIR`, `TMP` and `TEMP` at one parent, `/tmp/squeal-vitest-<pid>-XXXXXX`,
 * before the workers start, and they inherit it; teardown removes it, and
 * the next setup removes each parent whose Vitest process is gone. Under a
 * daemon the tests already write into its key directory, which the daemon
 * clears (`src/core/daemon/scratch.ts`), so setup makes no parent there.
 *
 * A PID names a process only in its own PID namespace, and `/tmp` can be
 * shared by another (a container's), so each parent records its run's
 * namespace in `OWNER`, and the sweep removes only parents of its own
 * namespace (review 0.1.267 B1).
 *
 * Row 011-140: setup clears `PLUGIN_ROOT` and `PLUGIN_DATA` before the
 * workers start, and teardown puts them back. A Codex hook names its
 * installed plugin and data directory in them, and a run under the daemon
 * that hook spawned inherits both. `test/harness/opencode/latency.test.ts`
 * hands its environment to the bundled Codex hooks, whose SessionStart then
 * kept a copy named for this tree's version from the installed, older plugin
 * (`versions/0.1.274` with 0.1.273 code, 2026-10-23).
 */

/** Where the run's temp parent goes and the environment that names it; tests pass their own. */
export interface TempOptions {
  readonly env: NodeJS.ProcessEnv;
  readonly root: string;
}

const TEMP_VARIABLES = ["TMPDIR", "TMP", "TEMP"] as const;
const PLUGIN_VARIABLES = ["PLUGIN_ROOT", "PLUGIN_DATA"] as const;

/** The name `mkdtemp` gives a parent: six characters after the prefix (review 0.1.267 S1). */
const PARENT = /^squeal-vitest-([1-9]\d*)-[A-Za-z0-9]{6}$/;

/** The file in a parent that names its run's PID namespace. */
const OWNER = ".pid-namespace";

export default async function setup(
  project: TestProject,
  temp: TempOptions = { env: process.env, root: "/tmp" },
): Promise<() => Promise<void>> {
  await sweepDeadRuns();
  sweepDeadParents(temp.root);
  const restoreTemp = useTempParent(temp);
  const restorePlugin = clearPluginVariables(temp.env);
  // The Vitest process in the name: a run is live while it is.
  const runDir = join(TEST_CACHE, `run-${process.pid}-${randomUUID()}`);
  mkdirSync(runDir, { recursive: true });
  project.provide("squealTestRun", runDir);
  return async () => {
    const strays = findProcesses(`${runDir}/`);
    await killProcesses(strays);
    const message = strays.length === 0 ? null : leakMessage(runDir, strays);
    rmSync(runDir, { recursive: true, force: true });
    restoreTemp();
    restorePlugin();
    if (message !== null) throw new Error(message);
  };
}

/** Points the temp variables at a new parent under `root`; returns what removes it and restores them. */
/** Clears a Codex hook's plugin variables from `env`; the function returned puts them back. */
function clearPluginVariables(env: NodeJS.ProcessEnv): () => void {
  const found = PLUGIN_VARIABLES.map((name) => [name, env[name]] as const);
  for (const name of PLUGIN_VARIABLES) delete env[name];
  return () => {
    for (const [name, value] of found) if (value !== undefined) env[name] = value;
  };
}

function useTempParent({ env, root }: TempOptions): () => void {
  if (env.TMPDIR?.startsWith(`${userTmpDir()}/tmp/`) === true) return () => undefined;
  let parent: string;
  try {
    // Under `/tmp`, whatever `TMPDIR` says, as a daemon's key directory is
    // (`userTmpDir`): at most 33 bytes, under the key directory's 37, so the
    // tests' socket paths fit. Under a 48-byte `TMPDIR` the parent was 77
    // bytes, and `test/ps/proc-live.test.ts` failed to bind (task 014-36).
    parent = mkdtempSync(join(root, `squeal-vitest-${process.pid}-`));
    const namespace = namespaceName();
    // Without a namespace no sweep may take it; its own teardown still removes it.
    if (namespace !== null) writeFileSync(join(parent, OWNER), namespace);
  } catch {
    // The suite runs without a parent rather than not at all.
    return () => undefined;
  }
  const found = TEMP_VARIABLES.map((name) => [name, env[name]] as const);
  for (const name of TEMP_VARIABLES) env[name] = parent;
  return () => {
    for (const [name, value] of found) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch (error) {
      // A directory a test made read-only, say; the run does not fail on it.
      process.stderr.write(`squeal tests: could not remove ${parent}: ${String(error)}\n`);
    }
  };
}

function leakMessage(runDir: string, strays: readonly Stray[]): string {
  const lines = strays.map(({ pid, args }) => {
    const owner = ownerOf(runDir, args);
    return `  ${owner ?? "(test file unknown)"}: pid ${pid}, ${args}`;
  });
  return [
    `${strays.length} process(es) from the test build outlived the run; killed (lessons, defect 29):`,
    ...lines,
  ].join("\n");
}

/** Kills what runs from a cache entry no live run owns, and removes run directories of dead runs. */
async function sweepDeadRuns(): Promise<void> {
  const strays = findProcesses(`${TEST_CACHE}/`).filter(
    ({ args }) => !runAlive(entryUnder(TEST_CACHE, args)),
  );
  if (strays.length > 0) {
    const pids = strays.map(({ pid }) => pid).join(", ");
    process.stderr.write(
      `squeal tests: killing ${strays.length} process(es) an earlier run left: ${pids}\n`,
    );
    await killProcesses(strays);
  }
  let entries: string[] = [];
  try {
    entries = readdirSync(TEST_CACHE);
  } catch {
    // No test has built yet.
  }
  for (const entry of entries) {
    if (entry.startsWith("run-") && !runAlive(entry)) {
      rmSync(join(TEST_CACHE, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Removes each `squeal-vitest-<pid>-XXXXXX` of this user under `root` that a
 * run in this PID namespace made and whose Vitest process is gone. A parent
 * without `OWNER` is kept: another namespace's, or one a setup is making.
 */
function sweepDeadParents(root: string): void {
  let entries: string[] = [];
  try {
    entries = readdirSync(root);
  } catch {
    return;
  }
  const namespace = namespaceName();
  if (namespace === null) return;
  for (const entry of entries) {
    const match = PARENT.exec(entry);
    if (match === null || isAlive(Number(match[1]))) continue;
    const path = join(root, entry);
    try {
      const stat = lstatSync(path);
      if (!stat.isDirectory() || stat.uid !== currentUid()) continue;
      if (readFileSync(join(path, OWNER), "utf8") !== namespace) continue;
      rmSync(path, { recursive: true });
    } catch {
      // Gone already, without `OWNER`, or not ours to remove.
    }
  }
}

/**
 * This process's PID namespace, or `null` on Linux when it cannot be read: a
 * masked `/proc` there may hide another namespace (review 0.1.267 round 2).
 * Elsewhere there are no PID namespaces, and the platform names the one.
 */
export function namespaceName(
  read: () => string | null = pidNamespace,
  platform: NodeJS.Platform = process.platform,
): string | null {
  return read() ?? (platform === "linux" ? null : platform);
}

/** `run-<pid>-<uuid>` of a Vitest process still running. */
function runAlive(entry: string): boolean {
  const match = /^run-(\d+)-/.exec(entry);
  return match !== null && isAlive(Number(match[1]));
}
