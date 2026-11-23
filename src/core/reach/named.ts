import { compare } from "../fs/compare.js";
import type { RelativePath } from "../types/common.js";
import type { Analysis } from "./analyze.js";
import { editsOf, mainRoute, noteOf, routeOf, split } from "./entries.js";
import type { NamedFile } from "./report-types.js";
import { secondGateway, suggestionFor } from "./suggest.js";
import type { ReachSnapshot } from "./types.js";

/*
 * Spec 015 D11: the named files in full, each route with its test files.
 * `--limit` bounds the routes of a file and the test files of a route
 * (015-116, P10): one route of cezar's sequencer listed 1,568 test files.
 * `--offset` skips test files of each route, never routes, so a page of
 * test files keeps every route (row 015-129).
 */

/** Whether a path is one of `paths` or under one; `""` names the whole worktree. */
export const named = (paths: readonly RelativePath[]) => (path: RelativePath) =>
  paths.some((p) => p === "" || path === p || path.startsWith(`${p}/`));

/**
 * Row 015-129: `[offset, offset + limit)` of `items` and how many follow it;
 * past the end, an empty page and none more. `limit` may be infinite.
 */
export function page<T>(items: readonly T[], offset: number, limit: number): [T[], number] {
  const shown = items.slice(offset, offset + limit);
  return [shown, Math.max(0, items.length - offset - shown.length)];
}

export function namedFiles(
  analysis: Analysis,
  snapshot: ReachSnapshot,
  paths: readonly RelativePath[],
  limit: number,
  offset = 0,
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
        const edits = editsOf([file], analysis);
        return {
          path: file.path,
          testFiles: file.testFiles,
          seconds: file.seconds,
          share: total > 0 ? file.seconds / total : 0,
          ...edits,
          coverage: split(file.coverage, file.seconds),
          routes: routes.slice(0, limit).map((r) => {
            const tests = [...(r.tests ?? [])].sort(
              (a, b) => (b.seconds ?? 0) - (a.seconds ?? 0) || compare(a.path, b.path),
            );
            const [shown, moreTests] = page(tests, offset, limit);
            return { ...routeOf(r), tests: shown, moreTests };
          }),
          moreRoutes: Math.max(0, routes.length - limit),
          second: route === null ? null : secondGateway([file.path], route, snapshot, file),
          suggestion: route === null ? null : suggestionFor([file.path], route, snapshot, file),
          ...noteOf([file], file.kinds, analysis, edits.editShare),
        };
      }),
    ...absent.map((path) => ({
      path,
      testFiles: 0,
      seconds: 0,
      share: 0,
      edits: analysis.edits.get(path) ?? 0,
      editSeconds: 0,
      editShare: 0,
      coverage: {},
      routes: [],
      moreRoutes: 0,
      second: null,
      suggestion: null,
    })),
  ];
}
