import type { CoverageRun, CoveredFile, ExecutedSource } from "../code/coverage/types.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 021 D6 (row 021-11): a run's coverage payloads as JSON. A covered
 * file's `sources` is a map, and the test files of one run share most
 * sources, so each source is sent once per run and named by its index. A
 * local host's payload paths are the daemon's own: the records' writer reads
 * and deletes them as it does an in-process run's.
 *
 * Spec 024 D3 (row 024-03): the files of one environment share one sources
 * map, so each distinct map is sent once per run, in `tables`, and a file
 * names its table. A wire from before the row, with each file's own
 * `sources`, still decodes.
 */

/** One source of a table: its absolute path and its index into `WireCoverageRun.sources`. */
export type WireSourceEntry = readonly [AbsolutePath, number];

/** One covered file: its sources' table, or, before row 024-03, its own entries. */
export interface WireCoveredFile extends Omit<CoveredFile, "sources"> {
  /** Row 024-03: the index of its sources into `WireCoverageRun.tables`. */
  readonly table?: number;
  /** Before row 024-03: its sources by absolute path and index into `WireCoverageRun.sources`. */
  readonly sources?: readonly WireSourceEntry[];
}

export interface WireCoverageRun {
  readonly runId: string;
  readonly sources: readonly ExecutedSource[];
  /** Row 024-03: each distinct sources map of the run once. */
  readonly tables?: readonly (readonly WireSourceEntry[])[];
  readonly files: readonly WireCoveredFile[];
}

type Sources = CoveredFile["sources"];

/** `run` as JSON, each distinct source object and each distinct sources map once. */
export function encodeCoverageRun(run: CoverageRun): WireCoverageRun {
  const index = new Map<ExecutedSource, number>();
  const sources: ExecutedSource[] = [];
  const tableOf = new Map<Sources, number>();
  const tables: WireSourceEntry[][] = [];
  const entry = ([path, source]: [AbsolutePath, ExecutedSource]): WireSourceEntry => {
    let at = index.get(source);
    if (at === undefined) {
      at = sources.push(source) - 1;
      index.set(source, at);
    }
    return [path, at];
  };
  const files = run.files.map(({ sources: map, ...file }): WireCoveredFile => {
    let table = tableOf.get(map);
    if (table === undefined) {
      table = tables.push([...map].map(entry)) - 1;
      tableOf.set(map, table);
    }
    return { ...file, table };
  });
  return { runId: run.runId, sources, tables, files };
}

/** The run `encodeCoverageRun` encoded; a source or a table shared before is one object again. */
export function decodeCoverageRun(wire: WireCoverageRun): CoverageRun {
  const decoded = new Map<number, Sources>();
  const mapOf = (entries: readonly WireSourceEntry[]): Sources => {
    const sources = new Map<AbsolutePath, ExecutedSource>();
    for (const [path, at] of entries) {
      const source = wire.sources[at];
      if (source === undefined) throw new Error(`coverage source ${at} of ${path} was not sent`);
      sources.set(path, source);
    }
    return sources;
  };
  const tableOf = (at: number): Sources => {
    let sources = decoded.get(at);
    if (sources === undefined) {
      const entries = wire.tables?.[at];
      if (entries === undefined) throw new Error(`coverage sources table ${at} was not sent`);
      sources = mapOf(entries);
      decoded.set(at, sources);
    }
    return sources;
  };
  const files = wire.files.map(
    ({ table, sources, ...file }): CoveredFile => ({
      ...file,
      sources: table === undefined ? mapOf(sources ?? []) : tableOf(table),
    }),
  );
  return { runId: wire.runId, files };
}
