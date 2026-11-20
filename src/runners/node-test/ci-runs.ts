import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  NODE_TEST_UNASSIGNED,
  type PartEnd,
  type PartFile,
  type PartNodeTest,
  type PartShard,
} from "../../core/ci/parts.js";
import { compare } from "../../core/fs/compare.js";
import type { WorktreePaths } from "../../core/fs/worktree-paths.js";
import { configFieldHash } from "../../core/keys/environment-descriptor.js";
import type { AbsolutePath } from "../../core/types/common.js";
import { preloadSpecifiers, tokenizeNodeOptions } from "../process/node-options.js";
import { eventsByFile, finalSummary, nodeBuildOf, partFile, wrapperName } from "./ci-files.js";
import { refusedFlag, shardOf } from "./ci-flags.js";
import { parseEvents, type TestEvent } from "./run/events.js";
import { type ObservedClosure, observedClosure } from "./run/observed.js";
import { readFileStream } from "./run/report.js";

/*
 * Spec 018 D23 to D25 (row 018-47): the files of a node:test recording and
 * the part body each `node --test` process becomes. Its reporter's file
 * holds the process's header, then its events; each test file's events are
 * read by the daemon's own code (`readFileStream`: checks, names, outcomes),
 * and its loads by the daemon's `observedClosure` over the module recorder's
 * edges of that file's processes. A file is in the part only when its run
 * completed and the recorder saw it load: never keyed without its loads.
 */

/** One `node --test` process's part body below its header. */
export interface NodeTestRecordedRun {
  readonly end: PartEnd;
  readonly runnerVersion: string;
  readonly shard: PartShard;
  readonly observing: boolean;
  readonly nodeTest: PartNodeTest;
  readonly testFiles: readonly PartFile[];
}

/** The fields of Node the daemon's probe hashes into `nodeBuild` (`probeNode`), as written raw. */
interface RawProbe {
  readonly version: string;
  readonly build: unknown;
}

/** The reporter's first line (`node-test-reporter.mjs`). */
interface RawHeader extends RawProbe {
  readonly pid: number;
  readonly execArgv: readonly string[];
  readonly cwd: AbsolutePath;
  readonly env: Readonly<Record<string, string | null>>;
}

/** A test file process's line (`node-test-ci.cjs`): its file and its `node --test` process. */
interface RawInfo extends RawProbe {
  readonly pid: number;
  readonly file: AbsolutePath;
  readonly ppid: number;
  readonly cwd: AbsolutePath;
}

export interface RunsContext {
  readonly paths: WorktreePaths;
  /** The command's own `NODE_OPTIONS`, whose preloads root the preload phase, as the daemon's argv's do. */
  readonly nodeOptions: string;
}

/** The reporter's line when a process ran test files and left no events (D23.5). */
export const NO_REPORTER =
  'this node:test command names no Squeal reporter; add `--test-reporter="$SQUEAL_NODE_TEST_REPORTER" --test-reporter-destination=stderr`';

/** Each `node --test` process's part body, and a note per process or file left out. */
export function readNodeTestRuns(
  dirs: { readonly graph: AbsolutePath; readonly events: AbsolutePath },
  context: RunsContext,
): { runs: NodeTestRecordedRun[]; notes: string[] } {
  const infos = readInfos(dirs.graph);
  const runs: NodeTestRecordedRun[] = [];
  const notes: string[] = [];
  const reported = new Set<number>();
  for (const name of readdirSync(dirs.events).sort(compare)) {
    const text = readFileSync(join(dirs.events, name), "utf8");
    const header = headerOf(text);
    if (header === null) {
      notes.push(`node --test process ${name}: its reporter wrote no header; no part`);
      continue;
    }
    reported.add(header.pid);
    const mine = infos.filter((info) => info.ppid === header.pid);
    runs.push(processRun(header, parseEvents(text), mine, dirs.graph, context, notes));
  }
  const silent = new Map<number, RawInfo>();
  for (const info of infos) if (!reported.has(info.ppid)) silent.set(info.ppid, info);
  if (silent.size > 0) notes.push(NO_REPORTER);
  for (const info of silent.values()) {
    runs.push(
      emptyRun({ ...info, execArgv: [], env: {} }, context.paths, "completed", NO_REPORTER),
    );
  }
  return { runs, notes };
}

function processRun(
  header: RawHeader,
  events: readonly TestEvent[],
  infos: readonly RawInfo[],
  graph: AbsolutePath,
  context: RunsContext,
  notes: string[],
): NodeTestRecordedRun {
  const { paths } = context;
  const refused = refusedFlag(header.execArgv);
  if (refused !== null) {
    const why = `node --test ran with ${refused}, a run the daemon never makes: no test file recorded`;
    notes.push(why);
    return emptyRun(header, paths, "completed", why);
  }
  const ended = events.some((e) => e.type === "test:summary" && e.data.file === null);
  if (!ended) return emptyRun(header, paths, "crashed");
  const preloads = new Set(
    preloadSpecifiers([...(tokenizeNodeOptions(context.nodeOptions) ?? []), ...header.execArgv]),
  );
  const files: PartFile[] = [];
  const closures: ObservedClosure[] = [];
  for (const [absolute, own] of eventsByFile(events, header.cwd)) {
    const path = paths.toRelative(absolute);
    if (path === null) continue;
    const testFile = { project: NODE_TEST_UNASSIGNED, path };
    const report = readFileStream(
      {
        testFile,
        arg: wrapperName(own, absolute, header.cwd),
        events: [...own, ...finalSummary(events)],
      },
      paths,
    );
    if (!report.completed) continue;
    const texts = infos
      .filter((info) => resolve(info.file) === absolute)
      .flatMap((info) => graphTexts(graph, info.pid));
    const closure = observedClosure(testFile, absolute, texts, preloads, paths);
    if (closure === null) {
      notes.push(`${path}: the module recorder saw it load nothing; left out`);
      continue;
    }
    closures.push(closure);
    files.push(
      partFile(testFile, report.results, report.fileError !== null, report.durationMs, closure),
    );
  }
  const loadedFirst = [...new Set(closures.flatMap((c) => c.preloadPaths))].sort(compare);
  const run = emptyRun(header, paths, "completed");
  const nodeTest =
    loadedFirst.length > 0 ? { ...run.nodeTest, preloads: loadedFirst } : run.nodeTest;
  return { ...run, nodeTest, testFiles: files.sort((a, b) => compare(a.path, b.path)) };
}

/** A part body with no file, and why when one is given. */
function emptyRun(
  header: Pick<RawHeader, "execArgv" | "cwd" | "env" | "version" | "build">,
  paths: WorktreePaths,
  end: PartEnd,
  noFiles?: string,
): NodeTestRecordedRun {
  const cwd = relative(paths.root, header.cwd).split(sep).join("/");
  const nodeTest: PartNodeTest = {
    execArgv: [...header.execArgv],
    cwd,
    version: header.version,
    nodeBuild: nodeBuildOf(header.build),
    env: Object.fromEntries(
      Object.entries(header.env).map(([name, value]) => [
        name,
        value === null ? null : configFieldHash(value),
      ]),
    ),
    ...(noFiles === undefined ? {} : { noFiles }),
  };
  return {
    end,
    runnerVersion: header.version,
    shard: shardOf(header.execArgv),
    observing: true,
    nodeTest,
    testFiles: [],
  };
}

function headerOf(text: string): RawHeader | null {
  const first = text.slice(0, text.indexOf("\n"));
  try {
    const header = (JSON.parse(first) as { header?: Partial<RawHeader> }).header;
    if (typeof header?.pid !== "number" || !Array.isArray(header.execArgv)) return null;
    if (typeof header.cwd !== "string" || typeof header.version !== "string") return null;
    return { ...header, env: header.env ?? {} } as RawHeader;
  } catch {
    return null;
  }
}

/** Each test file process's line in `graph` (`<pid>.json`). */
function readInfos(graph: AbsolutePath): RawInfo[] {
  const infos: RawInfo[] = [];
  for (const name of readdirSync(graph).filter((n) => /^\d+\.json$/.test(n))) {
    try {
      const info = JSON.parse(readFileSync(join(graph, name), "utf8")) as Omit<RawInfo, "pid">;
      if (typeof info.file === "string" && typeof info.ppid === "number") {
        infos.push({ ...info, pid: Number(name.slice(0, -".json".length)) });
      }
    } catch {
      // a process killed while it wrote: its file runs again in the daemon
    }
  }
  return infos;
}

/** The module recorder's files of one test file process and the processes it started. */
function graphTexts(graph: AbsolutePath, pid: number): string[] {
  const prefix = `${pid}-`;
  return readdirSync(graph)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".ndjson"))
    .map((name) => readFileSync(join(graph, name), "utf8"));
}
