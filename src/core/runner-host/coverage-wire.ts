import type { CoverageRun, CoveredFile, ExecutedSource } from "../code/coverage/types.js";
import type { AbsolutePath } from "../types/common.js";

/*
 * Spec 021 D6 (row 021-11): a run's coverage payloads as JSON. A covered
 * file's `sources` is a map, and the test files of one run share most
 * sources, so each source is sent once per run and named by its index. A
 * local host's payload paths are the daemon's own: the records' writer reads
 * and deletes them as it does an in-process run's.
 */

/** One covered file, its sources by absolute path and index into `WireCoverageRun.sources`. */
export interface WireCoveredFile extends Omit<CoveredFile, "sources"> {
  readonly sources: readonly (readonly [AbsolutePath, number])[];
}

export interface WireCoverageRun {
  readonly runId: string;
  readonly sources: readonly ExecutedSource[];
  readonly files: readonly WireCoveredFile[];
}

/** `run` as JSON, each distinct source object once. */
export function encodeCoverageRun(run: CoverageRun): WireCoverageRun {
  const index = new Map<ExecutedSource, number>();
  const sources: ExecutedSource[] = [];
  const files = run.files.map((file): WireCoveredFile => {
    const entries = [...file.sources].map(([path, source]): [AbsolutePath, number] => {
      let at = index.get(source);
      if (at === undefined) {
        at = sources.push(source) - 1;
        index.set(source, at);
      }
      return [path, at];
    });
    return { ...file, sources: entries };
  });
  return { runId: run.runId, sources, files };
}

/** The run `encodeCoverageRun` encoded; a source shared before is one object again. */
export function decodeCoverageRun(wire: WireCoverageRun): CoverageRun {
  const files = wire.files.map((file): CoveredFile => {
    const sources = new Map<AbsolutePath, ExecutedSource>();
    for (const [path, at] of file.sources) {
      const source = wire.sources[at];
      if (source === undefined) throw new Error(`coverage source ${at} of ${path} was not sent`);
      sources.set(path, source);
    }
    return { ...file, sources };
  });
  return { runId: wire.runId, files };
}
