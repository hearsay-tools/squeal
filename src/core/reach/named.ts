import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import type { Analysis } from "./analyze.js";
import { mainRoute, noteOf, routeOf, split } from "./entries.js";
import type { NamedFile } from "./report-types.js";
import { secondGateway, suggestionFor } from "./suggest.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11: the named files in full, each route with its test files.
 * `--limit` bounds the routes of a file and the test files of a route
 * (015-116, P10): one route of cezar's sequencer listed 1,568 test files.
 */

/** Whether a path is one of `paths` or under one; `""` names the whole worktree. */
export const named = (paths: readonly RelativePath[]) => (path: RelativePath) =>
  paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));

export function namedFiles(
  analysis: Analysis,
  snapshot: ReachSnapshot,
  paths: readonly RelativePath[],
  limit: number,
): NamedFile[] {
  const isNamed = named(paths);
  const total = analysis.suite.seconds;
  const files = [...analysis.files.values()].filter((f) => isNamed(f.path));
  const found = new Set(files.map((f) => f.path));
  const absent = paths.filter((p) => ![...found].some((f) => named([p])(f)));
  return [
    ...files
      .sort((a, b) => compare(a.path, b.path))
      .map((file): NamedFile => {
        const route = mainRoute(file);
        const routes = [...file.routes.values()].sort((a, b) => b.seconds - a.seconds);
        return {
          path: file.path,
          testFiles: file.testFiles,
          seconds: file.seconds,
          share: total > 0 ? file.seconds / total : 0,
          edits: analysis.edits.get(file.path) ?? 0,
          coverage: split(file.coverage, file.seconds),
          routes: routes.slice(0, limit).map((r) => {
            const tests = [...(r.tests ?? [])].sort(
              (a, b) => (b.seconds ?? 0) - (a.seconds ?? 0) || compare(a.path, b.path),
            );
            return {
              ...routeOf(r),
              tests: tests.slice(0, limit),
              moreTests: Math.max(0, tests.length - limit),
            };
          }),
          moreRoutes: Math.max(0, routes.length - limit),
          second: route === null ? null : secondGateway([file.path], route, snapshot, file),
          suggestion: route === null ? null : suggestionFor([file.path], route, snapshot, file),
          ...noteOf(file.kinds),
        };
      }),
    ...absent.map((path) => ({
      path,
      testFiles: 0,
      seconds: 0,
      share: 0,
      edits: analysis.edits.get(path) ?? 0,
      coverage: {},
      routes: [],
      moreRoutes: 0,
      second: null,
      suggestion: null,
    })),
  ];
}
