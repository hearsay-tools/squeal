import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { ownMap } from "../../core/ci/own-map.js";
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
import { preloadSpecifiers } from "../process/node-options.js";
import { eventsByFile, finalSummary, nodeBuildOf, partFile, wrapperName } from "./ci-files.js";
import { projectNodeOptions, refusedFlag, shardOf } from "./ci-flags.js";
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
  /**
   * B1: the project's Node options from the process's `NODE_OPTIONS`
   * (`projectNodeOptions`); `null` when Node's splitting fails, absent when
   * the reporter did not write it.
   */
  readonly options?: readonly string[] | null;
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
  const failed = readFailed(dirs.graph);
  const runs: NodeTestRecordedRun[] = [];
  const notes: string[] = [];
  const reported = new Set<number>();
  for (const name of listed(dirs.events).sort(compare)) {
    const text = readFileSync(join(dirs.events, name), "utf8");
    const header = headerOf(text);
    if (header === null) {
      if (!failed.has(Number(name.split(".")[0]))) {
        notes.push(`node --test process ${name}: its reporter wrote no header; no part`);
      }
      continue;
    }
    reported.add(header.pid);
    const why = failed.get(header.pid);
    if (why !== undefined) {
      notes.push(why);
      runs.push(emptyRun(header, context.paths, "crashed", why));
      continue;
    }
    const mine = infos.filter((info) => info.ppid === header.pid);
    runs.push(processRun(header, parseEvents(text), mine, dirs.graph, context, notes));
  }
  const silent = new Map<number, RawInfo>();
  for (const info of infos) if (!reported.has(info.ppid)) silent.set(info.ppid, info);
  if ([...silent.keys()].some((pid) => !failed.has(pid))) notes.push(NO_REPORTER);
  for (const [pid, info] of silent) {
    const why = failed.get(pid);
    if (why !== undefined) notes.push(why);
    const raw = { ...info, execArgv: [], env: {} };
    runs.push(
      emptyRun(raw, context.paths, why === undefined ? "completed" : "crashed", why ?? NO_REPORTER),
    );
  }
  return { runs, notes };
}

/** The names in `dir`; none when it is gone (a failure the reporter marks, B3). */
function listed(dir: AbsolutePath): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The suffix of the mark Squeal's reporter leaves when it could not record (`node-test-reporter.mjs`). */
const FAILED = ".reporter-failed";

/**
 * Review of 0.1.579 B3: each `node --test` process whose reporter could not
 * record, with the line that says so. Its part holds no file and is no
 * complete run: what it wrote may stop anywhere.
 */
function readFailed(graph: AbsolutePath): Map<number, string> {
  const failed = new Map<number, string>();
  for (const name of readdirSync(graph).filter((n) => n.endsWith(FAILED))) {
    const pid = Number(name.slice(0, -FAILED.length));
    let why = "";
    try {
      why = readFileSync(join(graph, name), "utf8").split("\n")[0] ?? "";
    } catch {}
    failed.set(
      pid,
      `node --test process ${pid}: Squeal's reporter could not record it (${why}); no test file recorded`,
    );
  }
  return failed;
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
  const refused = refusal(header);
  if (refused !== null) {
    notes.push(refused);
    return emptyRun(header, paths, "completed", refused);
  }
  const ended = events.some((e) => e.type === "test:summary" && e.data.file === null);
  if (!ended) return emptyRun(header, paths, "crashed");
  // Node reads `NODE_OPTIONS` before argv: its preloads root the preload phase too, as in the daemon's run.
  const preloads = new Set(preloadSpecifiers(flagsOf(header)));
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

/**
 * Why the process's run is one the daemon never makes (D25), its
 * `NODE_OPTIONS` included (review of 0.1.579 B1); `null` when it is not.
 */
function refusal(header: RawHeader): string | null {
  const daemon = "a run the daemon never makes: no test file recorded";
  if (header.options === null) {
    return `node --test ran with a NODE_OPTIONS Squeal cannot split as Node does: no test file recorded`;
  }
  const inOptions = refusedFlag(header.options ?? []);
  if (inOptions !== null) return `node --test ran with ${inOptions} from NODE_OPTIONS, ${daemon}`;
  const inArgv = refusedFlag(header.execArgv);
  return inArgv === null ? null : `node --test ran with ${inArgv}, ${daemon}`;
}

/** The process's Node flags in the order Node reads them: `NODE_OPTIONS`', then `execArgv`. */
function flagsOf(header: Pick<RawHeader, "execArgv" | "options">): string[] {
  return [...(header.options ?? []), ...header.execArgv];
}

/** A part body with no file, and why when one is given. */
function emptyRun(
  header: Pick<RawHeader, "execArgv" | "options" | "cwd" | "env" | "version" | "build">,
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
    env: ownMap(
      Object.entries(header.env).map(([name, value]) => [
        name,
        value === null ? null : configFieldHash(value),
      ]),
    ),
    ...(Array.isArray(header.options) ? { nodeOptions: [...header.options] } : {}),
    ...(noFiles === undefined ? {} : { noFiles }),
  };
  return {
    end,
    runnerVersion: header.version,
    shard: shardOf(flagsOf(header)),
    observing: true,
    nodeTest,
    testFiles: [],
  };
}

/** The header as the reporter writes it: `NODE_OPTIONS` raw, and the hooks `ci record` put there. */
interface WrittenHeader extends Omit<RawHeader, "options"> {
  readonly nodeOptions: string | null;
  readonly hooks: readonly string[];
}

function headerOf(text: string): RawHeader | null {
  const first = text.slice(0, text.indexOf("\n"));
  try {
    const header = (JSON.parse(first) as { header?: Partial<WrittenHeader> }).header;
    if (typeof header?.pid !== "number" || !Array.isArray(header.execArgv)) return null;
    if (typeof header.cwd !== "string" || typeof header.version !== "string") return null;
    const { nodeOptions, hooks, ...rest } = header;
    const written = nodeOptions === null || typeof nodeOptions === "string";
    const own = Array.isArray(hooks) ? hooks.filter((h) => typeof h === "string") : [];
    return {
      ...rest,
      env: header.env ?? {},
      ...(written ? { options: projectNodeOptions(nodeOptions, own) } : {}),
    } as RawHeader;
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
