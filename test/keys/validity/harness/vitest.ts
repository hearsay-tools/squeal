import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Reporter } from "vitest/node";
import type { RunnerAdapter, RunReport, TestFileRef } from "../../../../src/core/types/index.js";
import { VitestAdapter } from "../../../../src/runners/vitest/adapter.js";
import { loadVitest, type VitestNode } from "../../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../../src/runners/vitest/paths.js";
import type { CaseOutput, VitestInput } from "../case.js";
import { selectedOf, storedOf } from "./reported.js";
import { writeTree } from "./shared.js";

/*
 * The `adapter:vitest` kind (011 C14, task 011-37 section 2, row 011-41):
 * the tree's Vitest adapter class over a fixture, each run held inside its
 * test files until the paths it names are heard touched, as 013-01's
 * adapter regressions run it (`test/runners/vitest/touched-scope.test.ts`).
 * What a run reports is what the scheduler stores: the files it completed
 * and withheld, each result's identity, outcome and fingerprint, the files
 * that failed to load with theirs, as `recordsForFile` stores them (review of
 * cand/0.1.232, B1). The reason a run gives is wording. Vitest resolves from the
 * candidate's install at both trees (`compare.ts`).
 */

async function until(holds: () => boolean, what: string): Promise<void> {
  for (const end = Date.now() + 60_000; !holds(); await delay(20)) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
  }
}

/**
 * Rows 011-175 and 011-176: `node`, its instances given a reporter after the
 * adapter's own that adds the full name of each test whose result arrives to
 * `heard`. Vitest calls its reporters in turn in one pass (`Vitest.report`),
 * so a name in `heard` is a result the adapter's reporter already holds. A
 * delay after a test proves no such thing: Vitest 5.0.3's worker can hold a
 * result until its next task update (`tasks/011-175/notes.md`).
 */
export function witnessed(node: VitestNode, heard: Set<string>): VitestNode {
  const witness: Reporter = { onTestCaseResult: (test) => void heard.add(test.fullName) };
  const createVitest = (...[mode, options, ...rest]: Parameters<VitestNode["createVitest"]>) => {
    const own = options.reporters === undefined ? [] : [options.reporters].flat();
    const reporters = [...own, witness] as NonNullable<typeof options.reporters>;
    return node.createVitest(mode, { ...options, reporters }, ...rest);
  };
  return { ...node, createVitest: createVitest as VitestNode["createVitest"] };
}

/**
 * Once a held file started: `$STARTED` names, one per line, the tests whose
 * results reach the adapter's reporter before the run is cancelled (row
 * 011-175). A fixture that names some writes the marker whole, by a rename.
 */
async function untilStarted(marker: string, heard: ReadonlySet<string>): Promise<void> {
  await until(() => existsSync(marker), "a held test file to start");
  const named = readFileSync(marker, "utf8")
    .split("\n")
    .filter((name) => name !== "");
  await until(() => named.every((name) => heard.has(name)), `the results of ${named.join(", ")}`);
}

/**
 * For coverage only: the width hints the adapter answers, which the class
 * held at the last release and `index.ts` holds since 011-40. Hints decide
 * no stored row (C14), so what they answer is dropped.
 */
function hinted(adapter: RunnerAdapter, files: readonly TestFileRef[]): void {
  const [first] = files;
  adapter.slowWidth?.(files);
  if (first !== undefined) adapter.tierWidth?.(first, 2);
}

/** A `fileEnded` callback that throws: the run must still complete (row 011-54). */
const throwing = () => {
  throw new Error("fileEnded throws (validity case)");
};

/** `open()` with `TMPDIR` at `tmp`, when given, as `test/runners/vitest/broken.test.ts` starts one. */
async function withTmpDir(tmp: string | null, open: () => Promise<void>): Promise<void> {
  if (tmp === null) return open();
  mkdirSync(tmp, { recursive: true });
  const previous = process.env.TMPDIR;
  process.env.TMPDIR = tmp;
  try {
    await open();
  } finally {
    if (previous === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previous;
  }
}

/**
 * Row 015-11: the adapter's coverage when `input` asks it, through the
 * provider `prepare` copies beside the driver, where a plugin ships it.
 */
function coverageOf(input: VitestInput, scratch: string) {
  if (input.coverage === undefined) return undefined;
  const provider = fileURLToPath(new URL("../coverage/provider.mjs", import.meta.url));
  return {
    enabled: () => true,
    provider: input.coverage === "unloadable" ? unloadable(provider, scratch) : provider,
    tempDir: join(scratch, "coverage"),
    collected: () => {},
  };
}

/**
 * Row 015-70: a provider outside the worktree that loads `provider` through a
 * sibling by a computed URL. Vite's client environment loads no file outside
 * `server.fs.allow`, and import analysis allows none it cannot read, so each
 * worker fails to load it, as gh-102's did; the main process loads it.
 */
function unloadable(provider: string, scratch: string): string {
  const dir = join(scratch, "unloadable");
  mkdirSync(dir, { recursive: true });
  const sibling = `export { default } from ${JSON.stringify(pathToFileURL(provider).href)};\n`;
  writeFileSync(join(dir, "sibling.mjs"), sibling);
  writeFileSync(
    join(dir, "provider.mjs"),
    [
      'const sibling = import.meta.url.replace(/provider\\.mjs$/, "sibling.mjs");',
      "const { default: provider } = await import(/* @vite-ignore */ sibling);",
      "export default provider;",
      "",
    ].join("\n"),
  );
  return join(dir, "provider.mjs");
}

/**
 * Whether the harness waits for a run's held file to start. A run whose
 * signal was aborted first starts none, nor does one whose instance lost its
 * temp directory (it fails to load before any file starts), nor one whose
 * workers may not load the provider (row 015-70).
 */
const startsHeld = (run: VitestInput["runs"][number]) =>
  run.cancelBefore === undefined && run.removeTempDir !== true && run.unwaited !== true;

/** Row 015-70: after each run of an `unloadable` case, what `recheck` answers; a release before it has none. */
async function recheckAfter(input: VitestInput, adapter: RunnerAdapter, rechecks: unknown[]) {
  if (input.coverage === "unloadable") rechecks.push((await adapter.recheck?.()) ?? null);
}

/** Runs `input`'s runs in turn on one adapter over its fixture, under `scratch`. */
export async function vitestCase(input: VitestInput, scratch: string): Promise<CaseOutput> {
  const markers = join(scratch, "markers");
  mkdirSync(markers, { recursive: true });
  const [started, hold] = [join(markers, "started"), join(markers, "hold")];
  const files = Object.fromEntries(
    Object.entries(input.files).map(([path, text]) => [
      path,
      text
        .replaceAll("$STARTED", JSON.stringify(started))
        .replaceAll("$HOLD", JSON.stringify(hold)),
    ]),
  );
  const root = writeTree(join(scratch, "worktree"), files);
  const exclude = input.exclude ?? [];
  const heard = new Set<string>();
  const adapter = new VitestAdapter(
    new WorktreePaths(root),
    witnessed(await loadVitest(root), heard),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    () => exclude,
    coverageOf(input, scratch),
  );
  const reports: RunReport[] = [];
  const rechecks: unknown[] = [];
  // Row 013-06: a case that removes its instance's temp directory starts it under one of its own.
  const tmp = input.runs.some((run) => run.removeTempDir === true) ? join(scratch, "tmp") : null;
  let environments: unknown;
  try {
    await withTmpDir(tmp, () => adapter.open());
    if (input.environment === true) {
      environments = (await adapter.environment()).map((e) => [e.project, e.files]);
    }
    for (const [at, run] of input.runs.entries()) {
      writeFileSync(hold, "");
      rmSync(started, { force: true });
      heard.clear();
      const early = run.cancelBefore !== undefined;
      const cancel = run.cancel === undefined && !early ? null : new AbortController();
      // Review 0.1.239 B2: a signal aborted before the run starts.
      if (early) cancel?.abort(run.cancelBefore);
      const options = {
        runId: `validity-${at}`,
        logDir: join(scratch, "logs"),
        timeoutMs: null,
        ...(cancel === null ? {} : { signal: cancel.signal }),
        ...(run.fileEndedThrows === true ? { fileEnded: throwing } : {}),
        ...(run.checks === undefined ? {} : { checks: run.checks }),
      };
      if (run.removeTempDir === true && tmp !== null) rmSync(tmp, { recursive: true, force: true });
      const report = adapter.run(run.files, options);
      if (startsHeld(run)) {
        await untilStarted(started, heard);
        await adapter.invalidate(run.touched.map((path) => ({ path, kind: "touch" as const })));
        // Row 011-95: a revision's runner part during the run.
        for (const edit of run.edits ?? []) {
          const kind = existsSync(join(root, edit.path)) ? "change" : "add";
          writeTree(root, { [edit.path]: edit.text });
          await adapter.invalidate([{ path: edit.path, kind }]);
          await adapter.affected([edit.path]);
        }
        // Row 011-56: cancelled while held, the held file does not complete.
        cancel?.abort(run.cancel);
      }
      rmSync(hold, { force: true });
      reports.push(selectedOf(await report, run.checks));
      hinted(adapter, run.files);
      await recheckAfter(input, adapter, rechecks);
    }
  } finally {
    rmSync(hold, { force: true });
    await adapter.close();
  }
  return {
    ...(environments === undefined ? {} : { keys: { environments } }),
    outputs: { runs: reports.map(storedOf) },
    wording: { failures: reports.map((r) => r.failure), rechecks },
  };
}
