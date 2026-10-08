import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
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
 */

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  await sweepDeadRuns();
  // The Vitest process in the name: a run is live while it is.
  const runDir = join(TEST_CACHE, `run-${process.pid}-${randomUUID()}`);
  mkdirSync(runDir, { recursive: true });
  project.provide("squealTestRun", runDir);
  return async () => {
    const strays = findProcesses(`${runDir}/`);
    await killProcesses(strays);
    const message = strays.length === 0 ? null : leakMessage(runDir, strays);
    rmSync(runDir, { recursive: true, force: true });
    if (message !== null) throw new Error(message);
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

/** `run-<pid>-<uuid>` of a Vitest process still running. */
function runAlive(entry: string): boolean {
  const match = /^run-(\d+)-/.exec(entry);
  return match !== null && isAlive(Number(match[1]));
}
