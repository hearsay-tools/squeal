import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CiExport, ciExport } from "../../src/core/ci/export.js";
import { readPart } from "../../src/core/ci/parts.js";
import { coverageProvider } from "../../src/core/code/coverage/runtime.js";
import type { VitestCoverageOptions } from "../../src/core/code/coverage/types.js";
import { readHead } from "../../src/core/daemon-loop/head.js";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../../src/core/keys/key-format.js";
import type { ExportHeader } from "../../src/core/store/imports.js";
import { exportResults } from "../../src/core/store/transfer.js";
import type { ResultsBundle } from "../../src/core/store/transfer-bundle.js";
import type { AbsolutePath, WorktreeId } from "../../src/core/types/common.js";
import { DEFAULT_POLICY, type Policy } from "../../src/core/types/policy.js";
import type { Store } from "../../src/core/types/store.js";
import { createVitestAdapter } from "../../src/runners/vitest/index.js";
import { onCleanUp } from "../scheduler/cleanup.js";
import { openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { cloneOf, scratch } from "./fixture.js";

/*
 * Spec 018 D9 (row 018-17): a daemon's `squeal export` and `ci export` of
 * recorded parts, each in a fresh clone of one commit, for the parity tests.
 */

export const SQUEAL = "0.0.0-test";

/** Whether the daemon and the export observe runtime inputs (policy `observe.runtimeInputs`). */
export interface ParityOptions {
  readonly observe?: boolean;
  /** Spec 015 D8: the daemon collects coverage, and with it loaded lists (spec 022 D1). */
  readonly coverage?: boolean;
}

export function policyOf(options: ParityOptions): Policy {
  return { ...DEFAULT_POLICY, observe: { runtimeInputs: options.observe ?? true } };
}

export async function headerOf(root: string): Promise<ExportHeader> {
  const head = await readHead(root);
  return {
    squealVersion: SQUEAL,
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    dirty: head.dirty,
    createdAt: Date.now(),
    source: { kind: "local" },
  };
}

/**
 * Squeal's provider, its payloads in a temporary directory: the daemon's
 * runs collect with it, and the export's and the gate's adapters hold it as
 * the daemon's does, for the environment hash (`daemonVitestOptions`).
 */
export function daemonCoverage(): VitestCoverageOptions {
  const provider = coverageProvider();
  if (provider === null) throw new Error("no coverage provider beside the sources");
  const tempDir = mkdtempSync(join(tmpdir(), "squeal-ci-parity-")) as AbsolutePath;
  onCleanUp(() => rmSync(tempDir, { recursive: true, force: true }));
  return { provider, tempDir, enabled: () => true, collected: () => {} };
}

/** `squeal export` of a daemon that ran every file of a clone of `origin`, and its store. */
export async function daemonExport(
  origin: string,
  options: ParityOptions = {},
): Promise<{ bundle: ResultsBundle; store: Store }> {
  const root = cloneOf(origin, "daemon");
  const common = join(root, ".git");
  const observe = options.observe ?? true;
  const h = await openHarness(root, openRepoStore(common), common, {
    observe,
    policy: { observe: { runtimeInputs: observe } },
    ...(options.coverage === true ? { coverage: daemonCoverage() } : {}),
  });
  await h.scheduler.start();
  await h.scheduler.requestFullSuite();
  await h.scheduler.idle();
  const { bundle } = exportResults(h.store, h.worktreeId as WorktreeId, await headerOf(root));
  return { bundle, store: h.store };
}

/** The Vitest adapter's options a daemon with `options` builds in `root`. */
export function adapterOptions(root: string, options: ParityOptions) {
  const observe = options.observe ?? true;
  return {
    root,
    observe: () => observe,
    ...(options.coverage === true ? { coverage: daemonCoverage() } : {}),
  };
}

/** `ciExport` of the parts in `out`, in a fresh clone of `origin`, as the daemon's harness keys. */
export async function partsExport(
  origin: string,
  out: string,
  options: ParityOptions = {},
): Promise<CiExport & { root: string }> {
  const root = cloneOf(origin, "export");
  const parts = readdirSync(out).map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return { file: name, part };
  });
  const store = openRepoStore(join(scratch("ci-export-store"), "common"));
  const exported = await ciExport({
    root,
    worktreeId: worktreeIdFor(root),
    store,
    runner: () => createVitestAdapter(adapterOptions(root, options)),
    policy: policyOf(options),
    squealVersion: SQUEAL,
    env: process.env,
    parts,
    header: await headerOf(root),
    now: Date.now,
  });
  return { ...exported, root };
}
