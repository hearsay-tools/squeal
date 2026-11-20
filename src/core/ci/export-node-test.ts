import { compare } from "../fs/compare.js";
import { configFieldHash } from "../keys/environment-descriptor.js";
import { KEY_FORMAT_VERSION } from "../keys/key-format.js";
import type { ProjectName, RelativePath } from "../types/common.js";
import type { NamedPart } from "./export-check.js";
import type { Part, PartFile, PartNodeTest } from "./parts.js";

/*
 * Spec 018 D26 (row 018-48): which `nodeTest` entry of the export
 * checkout each recorded `node --test` process and test file belongs to,
 * and which entries' files the export leaves out. A process belongs to the
 * entries whose `cwd` is its working directory and whose `argv` is its
 * `execArgv` less the flags the daemon sets itself (D26.1); a file to the
 * one of them whose listing here holds it. An entry is left out whole when
 * a process of it ran on another Node (D26.2), saw another value of a
 * variable its `env` names (D26.3), or its own `--test-shard` set is not
 * complete (D26.4). Every such refusal leaves out files and names why,
 * never the whole export (D2, row 018-46): the Vitest parts beside are
 * not read here.
 */

/** One `nodeTest` entry as the export checkout has it. */
export interface NodeTestEntryHere {
  readonly name: ProjectName;
  /** Relative to the root, `/`-separated; `""` at the root. */
  readonly cwd: RelativePath;
  readonly argv: readonly string[];
  /**
   * Review of 0.1.579 B1: the Node options its processes get here from
   * `NODE_OPTIONS`, as the daemon's adapter reads them, without Squeal's
   * recorders. Node reads them before `argv`.
   */
  readonly nodeOptions: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  /** Its Node's probe here (D18), or `null` when that Node does not run. */
  readonly node: { readonly version: string; readonly nodeBuild: string } | null;
  /** The test files its adapter lists here. */
  readonly files: ReadonlySet<RelativePath>;
}

export interface NodeTestAssignment {
  /** The parts with the files they give, each `project` its entry's name; parts that give none are not here. */
  readonly parts: readonly NamedPart[];
  /** Files of the node:test parts left out by D26. */
  readonly leftOut: number;
  /** Why, one line each, for a person: never a variable's value. */
  readonly lines: readonly string[];
}

/** Flags the daemon sets itself that take a value, as `--flag=value` or `--flag value` (D26.1). */
const OWN_WITH_VALUE = [
  "--test-reporter",
  "--test-reporter-destination",
  "--test-shard",
  "--test-concurrency",
];
/** Flags the daemon sets itself that take none. */
const OWN_ALONE = ["--test", "--enable-source-maps"];

/** `execArgv` without the flags the daemon sets itself: what an entry's `argv` must equal (D26.1). */
export function entryArgv(execArgv: readonly string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < execArgv.length; i++) {
    const arg = execArgv[i] as string;
    if (OWN_ALONE.includes(arg)) continue;
    if (OWN_WITH_VALUE.includes(arg)) {
      i++;
      continue;
    }
    if (OWN_WITH_VALUE.some((flag) => arg.startsWith(`${flag}=`))) continue;
    kept.push(arg);
  }
  return kept;
}

/**
 * The files `parts`, node:test parts of the checkout at `head`, give to
 * `entries`, and what D26 leaves out. A part that gives no evidence (another
 * key format or commit, a run that did not complete, no `nodeTest` header)
 * leaves out its own files; it still counts as its shard.
 */
export function assignNodeTest(
  parts: readonly NamedPart[],
  entries: readonly NodeTestEntryHere[],
  head: string | null,
): NodeTestAssignment {
  const lines: string[] = [];
  let leftOut = 0;
  const leave = (count: number, line: string) => {
    leftOut += count;
    lines.push(line);
  };
  const processes = parts.map((named) => processOf(named, entries, head));
  for (const { named, unusable, entries: matched } of processes) {
    const { file, part } = named;
    const count = part.testFiles.length;
    if (part.header.nodeTest?.noFiles !== undefined) {
      lines.push(`${file}: ${part.header.nodeTest.noFiles}`);
    } else if (unusable !== null) leave(count, `${file}: ${unusable}: left out${filesText(count)}`);
    else if (matched.length === 0)
      leave(count, `${file}: ${unmatchedText(part)}: left out${filesText(count)}`);
  }
  const refused = new Map<ProjectName, string>();
  for (const entry of entries) {
    const of = processes.filter((p) => p.entries.includes(entry));
    const why =
      of.length === 0
        ? null
        : entryRefusal(
            entry,
            of.map((p) => p.named),
          );
    if (why !== null) refused.set(entry.name, why);
  }
  const { kept, unlisted, shared, byEntry } = filesOf(processes, refused);
  for (const [name, why] of [...refused].sort(([a], [b]) => compare(a, b))) {
    leave(byEntry.get(name) ?? 0, `${why}: left out${filesText(byEntry.get(name) ?? 0)}`);
  }
  if (unlisted.length > 0) {
    leave(unlisted.length, `no nodeTest entry here lists ${namesText(unlisted)}: left out`);
  }
  if (shared.length > 0) {
    leave(shared.length, `two nodeTest entries here list ${namesText(shared)}: left out`);
  }
  return { parts: assigned(parts, kept), leftOut, lines };
}

/** Where each file of the usable, matched processes goes: its one entry, or why none. */
interface FileOwners {
  /** By part file name, each entry's files, `project` set to the entry. */
  readonly kept: ReadonlyMap<string, ReadonlyMap<ProjectName, readonly PartFile[]>>;
  /** Files no matched entry lists here. */
  readonly unlisted: readonly string[];
  /** Files two matched entries list, with the entries. */
  readonly shared: readonly string[];
  /** Files of each refused entry. */
  readonly byEntry: ReadonlyMap<ProjectName, number>;
}

function filesOf(
  processes: readonly Process[],
  refused: ReadonlyMap<ProjectName, string>,
): FileOwners {
  const kept = new Map<string, Map<ProjectName, PartFile[]>>();
  const unlisted: string[] = [];
  const shared: string[] = [];
  const byEntry = new Map<ProjectName, number>();
  for (const { named, unusable, entries: matched } of processes) {
    if (unusable !== null || matched.length === 0) continue;
    const files = new Map<ProjectName, PartFile[]>();
    kept.set(named.file, files);
    for (const file of named.part.testFiles) {
      const owners = matched.filter((entry) => entry.files.has(file.path));
      const [owner, ...more] = owners;
      if (owner === undefined) unlisted.push(file.path);
      else if (more.length > 0)
        shared.push(`${file.path} (${owners.map((o) => o.name).join(", ")})`);
      else if (refused.has(owner.name)) byEntry.set(owner.name, (byEntry.get(owner.name) ?? 0) + 1);
      else
        files.set(owner.name, [...(files.get(owner.name) ?? []), { ...file, project: owner.name }]);
    }
  }
  return { kept, unlisted, shared, byEntry };
}

interface Process {
  readonly named: NamedPart;
  /** Why the part gives no evidence; `null` when it may. */
  readonly unusable: string | null;
  /** The entries whose `cwd` and `argv` are the process's (D26.1). */
  readonly entries: readonly NodeTestEntryHere[];
}

function processOf(
  named: NamedPart,
  entries: readonly NodeTestEntryHere[],
  head: string | null,
): Process {
  const { nodeTest } = named.part.header;
  if (nodeTest === undefined) {
    return { named, unusable: "a node:test part without its nodeTest header", entries: [] };
  }
  const flags = recordedFlags(nodeTest);
  if (flags === null) {
    const unusable = "a node:test part that does not say what NODE_OPTIONS its process had";
    return { named, unusable, entries: [] };
  }
  const matched = entries.filter(
    (entry) => entry.cwd === nodeTest.cwd && sameList(entryFlags(entry), flags),
  );
  return { named, unusable: partUnusable(named.part, head), entries: matched };
}

/** Why a node:test part gives no evidence at `head`, as D9 refuses a Vitest part; `null` when it may. */
function partUnusable(part: Part, head: string | null): string | null {
  const { keyFormat, end, commit } = part.header;
  if (keyFormat !== KEY_FORMAT_VERSION) {
    return `made with key format ${keyFormat}; this Squeal keys with ${KEY_FORMAT_VERSION}`;
  }
  if (end !== "completed") return `a run that did not complete (${end})`;
  if (commit === null || commit !== head) {
    return `of commit ${commit ?? "none"}, and this checkout is at ${head ?? "no commit"}`;
  }
  return null;
}

/** Why `entry`'s files are left out, by the processes that belong to it: Node, variables, shards. */
function entryRefusal(entry: NodeTestEntryHere, parts: readonly NamedPart[]): string | null {
  const project = `project ${JSON.stringify(entry.name)}`;
  const runs = parts.map((p) => p.part.header.nodeTest as PartNodeTest);
  if (entry.node === null) return `${project}: its Node does not run here`;
  const { version, nodeBuild } = entry.node;
  const other = runs.find((run) => run.version !== version);
  if (other !== undefined) {
    return `node:test ran on Node ${other.version}; ${project} runs ${version} here`;
  }
  if (runs.some((run) => run.nodeBuild !== nodeBuild)) {
    return `node:test ran on another build of Node ${version} than ${project} runs here`;
  }
  const variables = Object.keys(entry.env)
    .sort(compare)
    .filter((name) => runs.some((run) => run.env[name] !== configFieldHash(entry.env[name])));
  if (variables.length > 0) {
    return `node:test ran with another value of ${variables.join(", ")} than ${project} sets`;
  }
  return shardsRefusal(project, parts);
}

/** D26.4: the processes of one entry are each shard of one `--test-shard` count, once; `null` when so. */
function shardsRefusal(project: string, parts: readonly NamedPart[]): string | null {
  const counts = [...new Set(parts.map((p) => p.part.header.shard.count))].sort((a, b) => a - b);
  if (counts.length > 1) return `${project} ran in runs of ${counts.join(", ")} shards`;
  const count = counts[0] as number;
  const indices = parts.map((p) => p.part.header.shard.index);
  const outside = indices.find((index) => index < 1 || index > count);
  if (outside !== undefined) return `${project} names shard ${outside}/${count}`;
  const twice = indices.find((index, at) => indices.indexOf(index) !== at);
  if (twice !== undefined) return `${project} has two parts of shard ${twice}/${count}`;
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter(
    (i) => !indices.includes(i),
  );
  if (missing.length === 0) return null;
  return `${project} has no part of shard ${missing.map((i) => `${i}/${count}`).join(", ")}`;
}

/** Each part with the files `kept` gives it, by entry, sorted as a part's files are. */
function assigned(
  parts: readonly NamedPart[],
  kept: ReadonlyMap<string, ReadonlyMap<ProjectName, readonly PartFile[]>>,
): NamedPart[] {
  return parts.flatMap(({ file, part }) => {
    const files = [...(kept.get(file)?.values() ?? [])].flat();
    if (files.length === 0) return [];
    const testFiles = files.sort(
      (a, b) => compare(a.project, b.project) || compare(a.path, b.path),
    );
    return [{ file, part: { ...part, testFiles } }];
  });
}

/**
 * The Node flags a recorded process ran with, in the order Node reads them
 * (`NODE_OPTIONS`', then `execArgv`), without those the daemon sets itself
 * (D26.1; review of 0.1.579 B1); `null` when the part does not say its
 * `NODE_OPTIONS`.
 */
function recordedFlags(nodeTest: PartNodeTest): string[] | null {
  if (!Array.isArray(nodeTest.nodeOptions)) return null;
  return entryArgv([...nodeTest.nodeOptions, ...nodeTest.execArgv]);
}

/** The flags the daemon gives an entry's processes here, as `recordedFlags` reads a part's. */
function entryFlags(entry: NodeTestEntryHere): string[] {
  return [...entryArgv(entry.nodeOptions), ...entry.argv];
}

function unmatchedText(part: Part): string {
  const nodeTest = part.header.nodeTest as PartNodeTest;
  const where = nodeTest.cwd === "" ? "the root" : nodeTest.cwd;
  const flags = JSON.stringify(recordedFlags(nodeTest));
  const options = (nodeTest.nodeOptions ?? []).length > 0 ? ", NODE_OPTIONS first" : "";
  return `no nodeTest entry here runs in ${where} with flags ${flags}${options}`;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Names shown in a line; the count says the rest. */
const NAMED = 3;

function namesText(names: readonly string[]): string {
  const sorted = [...names].sort(compare);
  const more = sorted.length > NAMED ? ` and ${sorted.length - NAMED} more` : "";
  return `${sorted.slice(0, NAMED).join(", ")}${more}`;
}

function filesText(count: number): string {
  return count === 0 ? "" : ` (${count} test file${count === 1 ? "" : "s"})`;
}
