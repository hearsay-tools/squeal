import type { CoverageRun } from "../../core/code/coverage/types.js";
import type { AbsolutePath, RelativePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { NodeTestGraph } from "./graph/index.js";
import type { CoveragePayload, Covering } from "./run/coverage.js";

/**
 * Spec 015 D8 (row 015-86): what the daemon gives a node:test adapter to
 * collect coverage in the runs it makes anyway. Absent, or `enabled`
 * false, no run takes coverage and the keys are those of 0.1.354.
 */
export interface NodeTestCoverage {
  /** Policy `coverage.enabled` with `complexity.enabled` (D1), read at each `environment`. */
  readonly enabled: () => boolean;
  /** Spec 020 D12: policy `coverage.children`, read with `enabled`; absent, never. */
  readonly children?: () => boolean;
  /** One run's payloads, handed over after its report is built; never awaited by the run. */
  readonly collected: (run: CoverageRun) => void;
}

/** D8 Fidelity: a closure that imports `node:inspector` or `inspector` can read V8 coverage. */
const INSPECTOR = "inspector";

/**
 * One project's coverage. Its key holds Squeal's marker exactly while its
 * runs take coverage, with `children` exactly while their children's too
 * (020 D12): `keyed` is what the last `environment` gave, and a run takes
 * coverage only then, so a record is stored only under a key that names
 * it. A policy change shows at the next `invalidate`, which recreates the
 * project so its checks re-key once. A project that runs its
 * test files in the `node --test` process (`--test-isolation=none`) takes
 * none, as a Vitest `isolate: false` project: there no process of the test
 * file's own deletes the variable, so a spawned child's coverage would mix
 * in.
 */
export class ProjectCoverage {
  #keyed: Covering;
  readonly #noted = new Set<string>();

  constructor(
    private readonly coverage: NodeTestCoverage | undefined,
    /** The project's argv, `NODE_OPTIONS` tokens first. */
    private readonly argv: readonly string[],
    private readonly note: (text: string) => void,
  ) {
    this.#keyed = this.#wanted();
  }

  /** For `environment`: what the key's marker names, kept for the next runs. */
  key(): Covering {
    this.#keyed = this.#wanted();
    if (this.coverage?.enabled() === true && sharesProcess(this.argv)) {
      this.#once(
        "coverage is off: --test-isolation=none runs its test files in the node --test process, where a process a test spawns would add its coverage (spec 015 D8)",
      );
    }
    return this.#keyed;
  }

  /** For `invalidate`: the policy turned coverage, or its children's, on or off since the last `environment`. */
  changed(): boolean {
    return this.#wanted() !== this.#keyed;
  }

  /**
   * For a run: what each file's process takes, `undefined` while the key
   * holds none. A file whose closure, or whose project's preloads, import
   * the inspector runs without, noted once (D8 Fidelity).
   */
  covered(
    graph: NodeTestGraph,
    files: readonly RelativePath[],
  ): ((testFile: TestFileRef) => Covering) | undefined {
    const keyed = this.#keyed;
    if (keyed === false) return undefined;
    const preloads = graph.environmentPackages().builtins.includes(INSPECTOR);
    const listed = new Set(files);
    return (testFile) => {
      const own = preloads ? true : reads(graph, listed, testFile.path);
      if (own === true) {
        const imports = preloads
          ? "its project's preloads import node:inspector"
          : "its closure imports node:inspector";
        this.#once(
          `coverage is off for ${testFile.path}: ${imports}, so its tests can see V8 coverage (spec 015 D8)`,
        );
      }
      return own === false && keyed;
    };
  }

  /** After a run: each completed file's payload, to the records' writer. */
  collect(runId: string, payloads: readonly CoveragePayload[], root: AbsolutePath): void {
    if (this.coverage === undefined || payloads.length === 0) return;
    const files = payloads.map(({ testFile, payload, children }) => ({
      testFile,
      payload,
      sources: new Map(),
      ownRoot: root,
      ...(children === undefined ? {} : { children: { root, dir: children } }),
    }));
    this.coverage.collected({ runId, files });
  }

  #wanted(): Covering {
    if (this.coverage?.enabled() !== true || sharesProcess(this.argv)) return false;
    return this.coverage.children?.() === true ? "children" : true;
  }

  #once(text: string): void {
    if (this.#noted.has(text)) return;
    this.#noted.add(text);
    this.note(text);
  }
}

/** Whether a test file's closure imports the inspector; `null` for a file the graph does not list. */
function reads(graph: NodeTestGraph, listed: ReadonlySet<RelativePath>, path: RelativePath) {
  return listed.has(path) ? graph.packages(path).builtins.includes(INSPECTOR) : null;
}

const ISOLATION = new Set(["--test-isolation", "--experimental-test-isolation"]);

/** Whether `argv` runs test files in the `node --test` process: `--test-isolation=none`. */
export function sharesProcess(argv: readonly string[]): boolean {
  let shared = false;
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    const equals = token.indexOf("=");
    const name = equals === -1 ? token : token.slice(0, equals);
    if (!ISOLATION.has(name)) continue;
    const value = equals === -1 ? argv[++i] : token.slice(equals + 1);
    // The last one counts, as Node reads options.
    shared = value === "none";
  }
  return shared;
}
