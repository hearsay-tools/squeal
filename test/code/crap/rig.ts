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
import type { CodeStore } from "../../../src/core/code/store/index.js";
import type { CodeMeasure } from "../../../src/core/types/code.js";
import type { Policy, RunOutcome, Store, TestFileRef } from "../../../src/core/types/index.js";
import { freshStore, result, WT } from "../../state/helpers.js";
import { commonDir, open } from "../helpers.js";
import { type FakeWorktree, fakeCounter, pass, policyOn, worktree } from "../pass/helpers.js";

/*
 * Row 015-12: a worktree with a fake counter's counts, a main store whose
 * test files load its sources, and their coverage records, for the
 * coverage step. A fake count's function `i` is on line `i + 1`, so a
 * record's function `[line, 0, line, 78, hit]` joins it.
 */

export const COVERED: Policy = { ...policyOn(), coverage: { enabled: true } };

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
}

export interface CoverageRig {
  readonly tree: FakeWorktree;
  readonly store: CodeStore;
  readonly main: Store;
  clock: number;
  /** Writes the files, stores a revision and runs the complexity pass. */
  edit(files: Record<string, string>): Promise<void>;
  /** Sets one test file's key, closure, results and record. */
  loader(path: string, spec: LoaderSpec): void;
  step(over?: Partial<CoverageStepInput>): ReturnType<typeof runCoverageStep>;
  /** `name outcome value` of each state of `measure`. */
  states(measure: CodeMeasure): string[];
  /** `measure kind name` of each transition of the file's functions, oldest first. */
  transitions(path: string, names: readonly string[]): string[];
}

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

export function coverageRig(): CoverageRig {
  const dir = commonDir();
  const main = freshStore();
  const tree = worktree(WT, dir);
  const store = open(dir);
  const settled = new Map<string, LoaderCondition>();
  const self: CoverageRig = {
    tree,
    store,
    main,
    clock: 100_000,
    async edit(files) {
      for (const [path, text] of Object.entries(files)) tree.write(path, text);
      tree.revise();
      self.clock += 1_000;
      const at = self.clock;
      await pass(tree, store, fakeCounter(), { policy: COVERED, now: () => at });
    },
    loader(path, spec) {
      const testFile: TestFileRef = { project: "", path };
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
      if (key === null) return;
      const check = { kind: "test" as const, project: "", testPath: path, fullName: "t" };
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
  };
  return self;
}
