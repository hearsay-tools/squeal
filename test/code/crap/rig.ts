import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  COVERAGE_PROVIDER_VERSION,
  type CoverageSource,
  encodeRecord,
} from "../../../src/core/code/coverage/index.js";
import {
  type CoverageStepInput,
  type LoaderCondition,
  runCoverageStep,
} from "../../../src/core/code/crap/index.js";
import type { Counter } from "../../../src/core/code/pass/index.js";
import type { PassContext } from "../../../src/core/code/pass/pass.js";
import type { CodeStore } from "../../../src/core/code/store/index.js";
import { codeSource } from "../../../src/core/delivery/code-source.js";
import {
  createDelivery,
  formatDelta,
  formatRegistration,
} from "../../../src/core/delivery/index.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import {
  type ClosureIndex,
  type Consumer,
  DEFAULT_POLICY,
  type Policy,
  type RunOutcome,
  type Store,
  type TestFileRef,
} from "../../../src/core/types/index.js";
import { fixedStatus } from "../../delivery/fakes.js";
import { freshStore, result, WT } from "../../state/helpers.js";
import { writePolicy } from "../delivery/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, policyOn, worktree } from "../pass/helpers.js";

/*
 * Row 015-12: a worktree with a fake counter's counts, a main store whose
 * test files load its sources, and their coverage records, for the
 * coverage step. A fake count's function `i` is on line `i + 1`, so a
 * record's function `[line, 0, line, 78, hit]` joins it.
 */

export const COVERED: Policy = {
  ...policyOn(),
  coverage: { ...DEFAULT_POLICY.coverage, enabled: true },
};

/** One loader of the rig: its key, results and record. */
export interface LoaderSpec {
  readonly closure: readonly string[];
  /** `null`: unkeyed. Default `key-<path>`. */
  readonly key?: string | null;
  readonly pending?: "queued" | "running";
  /** The outcomes stored at its key; none stored when empty. Default one `pass`. */
  readonly outcomes?: readonly RunOutcome[];
  /** The record's sources; `null` stores none. Default none. */
  readonly record?: readonly CoverageSource[] | null;
  readonly unread?: readonly string[];
  readonly recordedAt?: number;
  /**
   * The key this worktree's key index made; default the row's. `null`
   * leaves the test file out of the index: its closure is not known here.
   */
  readonly indexKey?: string | null;
  /** Review 0.1.354 B1: the loader's project; default `""`. */
  readonly project?: string;
}

export interface CoverageRig {
  readonly tree: FakeWorktree;
  readonly store: CodeStore;
  readonly main: Store;
  /** This worktree's key index: each loader's closure and key, as its scheduler holds them. */
  readonly closures: ClosureIndex & {
    set(path: string, entry: { key: string | null; paths: readonly string[] } | null): void;
    /** Row 015-75: the runner and environment files of `project` (default `""`); `null`, none read. */
    setEnvironment(
      entry: { runner: string; files: readonly string[] } | null,
      project?: string,
    ): void;
  };
  clock: number;
  /** Writes the files, stores a revision and runs the complexity pass, with `over` its context's. */
  edit(files: Record<string, string>, over?: Partial<PassContext>): Promise<void>;
  /** As `edit`, with the files committed first, so the revision moves `HEAD` as a pull does (015-19). */
  pull(files: Record<string, string>): Promise<void>;
  /** Runs the complexity pass with `counter` at the same revision, a recount when its version is new; later edits count with it. */
  recount(counter: Counter): Promise<void>;
  /** Sets one test file's key, closure, results and record. */
  loader(path: string, spec: LoaderSpec): void;
  step(over?: Partial<CoverageStepInput>): ReturnType<typeof runCoverageStep>;
  /** `name outcome value` of each state of `measure`. */
  states(measure: CodeMeasure): string[];
  /** `measure kind name` of each transition of the file's functions, oldest first. */
  transitions(path: string, names: readonly string[]): string[];
  /**
   * Row 015-75: writes squeal.config.json with complexity on, one project of
   * each runner in `runners`, and `more`'s keys.
   */
  configure(runners: readonly ("node-test" | "pytest")[], more?: Record<string, unknown>): void;
  /** Registers `consumer`; the formatted registration's lines (row 015-75). */
  register(consumer: Consumer): Promise<string[]>;
  /** The formatted delivery `consumer` gets at its next tool boundary; `[]` when none. */
  told(consumer: Consumer): Promise<string[]>;
}

export const consumer = (sessionId: string): Consumer => ({
  worktreeId: WT,
  sessionId,
  agentId: "main",
});

/** A record's entry for `path` at `blob`: every function line can run, `ran` lines ran. */
export function sourceOf(
  path: string,
  blob: string,
  functions: number,
  ran: readonly number[],
): CoverageSource {
  const bits = (lines: readonly number[]) => {
    const bytes = new Uint8Array(Math.ceil((functions + 1) / 8));
    for (const line of lines)
      bytes[(line - 1) >> 3] = (bytes[(line - 1) >> 3] ?? 0) | (1 << ((line - 1) & 7));
    return Buffer.from(bytes).toString("base64");
  };
  const all = Array.from({ length: functions }, (_, i) => i + 1);
  return {
    path,
    blob,
    lines: bits(all),
    covered: bits(ran),
    functions: all.map((line) => [line, 0, line, 78, ran.includes(line) ? 1 : 0] as const),
  };
}

/** The fake counter at version 2, with each function's name and CC as `as` gives them. */
export function counterV2(as: Record<string, readonly [name: string, cc: number]>): Counter {
  const inner = fakeCounter();
  return {
    version: 2,
    async count(text, language) {
      const counted = await inner.count(text, language);
      return {
        ...counted,
        functions: counted.functions.map((fn) => {
          const [qualifiedName, complexity] = as[fn.qualifiedName] ?? [fn.qualifiedName, 0];
          return {
            ...fn,
            qualifiedName,
            complexity: complexity || fn.complexity,
          };
        }),
      };
    },
  };
}

export function coverageRig(): CoverageRig {
  const dir = commonDir();
  const main = freshStore();
  const tree = worktree(WT, dir);
  const store = open(dir);
  const settled = new Map<string, LoaderCondition>();
  let counter: Counter = fakeCounter();
  const index = new Map<string, { key: string | null; paths: readonly string[] }>();
  const environments = new Map<string, { runner: string; files: readonly string[] }>();
  const closures: CoverageRig["closures"] = {
    key: (ref) => index.get(ref.path)?.key ?? null,
    closure: (ref) => index.get(ref.path),
    environment: (project) => environments.get(project),
    set(path, entry) {
      if (entry === null) index.delete(path);
      else index.set(path, entry);
    },
    setEnvironment(entry, project = "") {
      if (entry === null) environments.delete(project);
      else environments.set(project, entry);
    },
  };
  writePolicy(tree.root, { enabled: true });
  const source = codeSource(dir, tree.root);
  const delivery = () =>
    createDelivery(main, { status: fixedStatus(), now: () => self.clock, code: source });
  const self: CoverageRig = {
    tree,
    store,
    main,
    closures,
    clock: 100_000,
    async edit(files, over = {}) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.revise();
      self.clock += 1_000;
      const at = self.clock;
      await pass(tree, store, counter, { policy: COVERED, now: () => at, ...over });
    },
    async pull(files) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.commit(...Object.keys(files));
      tree.revise();
      self.clock += 1_000;
      const at = self.clock;
      await pass(tree, store, counter, { policy: COVERED, now: () => at });
    },
    async recount(next) {
      counter = next;
      self.clock += 1_000;
      const at = self.clock;
      await pass(tree, store, counter, { policy: COVERED, now: () => at });
    },
    loader(path, spec) {
      const project = spec.project ?? "";
      const testFile: TestFileRef = { project, path };
      const key = spec.key === undefined ? `key-${path}` : spec.key;
      main.testFiles.put({
        testFile,
        closure: {
          testFile,
          paths: [path, ...spec.closure],
          complete: false,
          method: "static imports plus declared inputs",
        },
        updatedAt: 1,
        updatedBy: WT,
      });
      main.testFileKeys.upsertMany([
        { worktreeId: WT, testFile, key, revision: 1, pending: spec.pending ?? null },
      ]);
      const indexKey = spec.indexKey === undefined ? key : spec.indexKey;
      closures.set(
        path,
        indexKey === null && key !== null
          ? null
          : { key: indexKey, paths: [path, ...spec.closure] },
      );
      if (key === null) return;
      const check = { kind: "test" as const, project, testPath: path, fullName: "t" };
      const results = (spec.outcomes ?? ["pass"]).map((outcome, i) => {
        const r = result({ ...check, fullName: `t${i}` }, outcome, { key });
        return { ...r, provenance: { ...r.provenance, recordedAt: spec.recordedAt ?? 1_000 } };
      });
      main.results.putMany(results);
      if (spec.record === undefined || spec.record === null) return;
      const record = { v: 1 as const, sources: spec.record, unread: spec.unread ?? [] };
      store.coverage.put(
        { resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION },
        encodeRecord(record),
        1,
      );
    },
    step(over = {}) {
      return runCoverageStep({
        store,
        main,
        closures,
        worktreeId: WT,
        revision: tree.source.latestRevision(),
        threshold: COVERED.crap.threshold,
        now: () => self.clock,
        writing: false,
        settled,
        reseed: false,
        ...over,
      });
    },
    states(measure) {
      return store.states
        .list(WT, { measure })
        .map((s) => `${s.check.qualifiedName} ${s.outcome} ${s.value ?? "-"}`);
    },
    transitions(path, names) {
      return names.flatMap((qualifiedName) =>
        store.transitions
          .history(WT, { kind: "code", path, qualifiedName, occurrence: 0 })
          .filter((t) => t.measure !== "complexity")
          .map((t) => `${t.measure} ${t.kind} ${qualifiedName}`),
      );
    },
    configure(runners, more = {}) {
      const projects = {
        ...(runners.includes("node-test")
          ? { nodeTest: [{ name: "unit", include: ["scripts/*.test.ts"] }] }
          : {}),
        ...(runners.includes("pytest")
          ? { pytest: [{ name: "py", include: ["tests/test_*.py"] }] }
          : {}),
      };
      const policy = { complexity: { enabled: true }, ...projects, ...more };
      writeFileSync(join(tree.root, "squeal.config.json"), JSON.stringify(policy));
    },
    async register(c) {
      self.clock += 1_000;
      return formatRegistration(await delivery().register(c)).split("\n");
    },
    async told(c) {
      self.clock += 1_000;
      const delta = await delivery().onToolBoundary(c);
      return delta === null ? [] : formatDelta(delta).split("\n");
    },
  };
  return self;
}
