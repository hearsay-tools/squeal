import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { costOf, costText } from "../core/ci/cost.js";
import {
  type CiExport,
  type CiExportCounts,
  ciExport,
  isNodeTest,
  type UncertifiedFile,
} from "../core/ci/export.js";
import type { NamedPart } from "../core/ci/export-check.js";
import { ownValue } from "../core/ci/own-map.js";
import { readPartsIn } from "../core/ci/parts.js";
import { coverageOn, coverageProvider } from "../core/code/coverage/runtime.js";
import { readPolicy } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { daemonVitestOptions } from "../core/daemon/vitest-options.js";
import { readHead } from "../core/daemon-loop/head.js";
import { findWorktreeRoot, worktreeIdFor } from "../core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import {
  type ContainerKey,
  type ContainerProbe,
  localContainerKey,
  probeLocalContainer,
  wrapContainerEnvironmentAdapter,
} from "../core/runner-host/container/key.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { AbsolutePathError } from "../core/store/transfer.js";
import { encodeBundle } from "../core/store/transfer-bundle.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { NodeTestProject, Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { createNodeTestAdapter } from "../runners/node-test/adapter.js";
import { vitestResolves } from "../runners/vitest/ci-record.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { absoluteLines, sourceOf } from "./export.js";
import type { CliIo } from "./main.js";

/** An export that refused nothing. */
type Exported = Exclude<CiExport, { readonly refused: unknown }>;

export const EXPORT_USAGE = "usage: squeal ci export --parts <dir|file>... [--out <file>]\n";

interface ExportArgs {
  readonly parts: readonly string[];
  readonly out: string | null;
}

/**
 * `squeal ci export --parts <dir|file>... [--out <file>]` (spec 018 D9). A
 * path may be a directory of parts or one part file (row 018-63). Exit 0, 1, or 2 as before.
 */
export async function ciExportCommand(
  args: readonly string[],
  io: CliIo,
  tempDir: AbsolutePath = tmpdir(),
): Promise<number> {
  const parsed = parseExport(args);
  if ("error" in parsed) {
    io.stderr(`squeal ci export: ${parsed.error}\n${EXPORT_USAGE}`);
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const say = (text: string) => io.stderr(`squeal ci export: ${text}; wrote nothing\n`);
  const root = findWorktreeRoot(cwd);
  if (root === null) return fail(say, `${cwd} is not inside a git worktree`);
  const parts = partsOrExit(parsed.parts, cwd, io, say);
  if (typeof parts === "number") return parts;
  // Row 018-29: what recording cost the shards, whatever the export does with their parts.
  const cost = costOf(parts.map(({ part }) => part));
  if (cost !== null) io.stderr(`squeal ci export: ${costText(cost)}\n`);
  const recorded = recordedRunners(root, parts);
  if (typeof recorded === "string") return fail(say, recorded);
  const policy = readPolicy(root);
  const head = await readHead(root);
  const header = {
    squealVersion: squealVersion(),
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    // Provenance: a shard's checkout counts too (git status, untracked files included).
    dirty: head.dirty || parts.some(({ part }) => part.header.dirty),
    createdAt: (io.now ?? Date.now)(),
    source: sourceOf(io.env ?? process.env),
  };
  const temp = mkdtempSync(join(tempDir, "squeal-ci-export-"));
  const store = openStore(temp);
  try {
    if (isStoreOpenFailure(store)) return fail(say, `no scratch store: ${JSON.stringify(store)}`);
    const exported = await ciExport({
      root,
      worktreeId: worktreeIdFor(root),
      store,
      runners: () =>
        daemonRunners(root, policy, temp, recorded, {
          squealVersion: header.squealVersion,
          env: io.env ?? process.env,
        }),
      policy,
      squealVersion: header.squealVersion,
      env: { ...(io.env ?? process.env) },
      parts,
      header,
      now: io.now ?? Date.now,
    });
    if ("refused" in exported) return fail(say, `refused: ${exported.refused.text}`);
    const commit8 = header.commit === null ? "unborn" : header.commit.slice(0, 8);
    return write(exported, resolve(cwd, parsed.out ?? `squeal-results-${commit8}.json.gz`), io);
  } catch (error) {
    if (!(error instanceof AbsolutePathError)) throw error;
    return fail(say, error.message);
  } finally {
    if (!isStoreOpenFailure(store)) store.close();
    rmSync(temp, { recursive: true, force: true });
  }
}

/**
 * The parts `--parts` names, or the exit code: 1 for a directory with no
 * part (review of 0.1.421 B3), 2 for a path that is neither a directory nor
 * a part file (row 018-63) or a part that does not read.
 */
function partsOrExit(
  paths: readonly string[],
  cwd: string,
  io: CliIo,
  say: (text: string) => void,
): NamedPart[] | number {
  const parts = readPartsIn(paths.map((path) => resolve(cwd, path)));
  if (typeof parts !== "string") return parts;
  if (parts.startsWith("no part (")) return fail(say, parts);
  io.stderr(`squeal ci export: ${parts}\n${EXPORT_USAGE}`);
  return 2;
}

/**
 * Writes `exported` to `file` unless it holds no test file; first names the
 * inputs that left the first few files out (`uncertifiedLines`).
 */
function write(exported: Exported, file: AbsolutePath, io: CliIo): number {
  for (const line of [
    ...uncertifiedLines(exported.uncertified),
    ...absoluteLines(exported.absolute),
    ...exported.nodeTestLines,
  ]) {
    io.stderr(`squeal ci export: ${line}\n`);
  }
  if (exported.counts.testFiles === 0) {
    io.stderr(`squeal ci export: ${nothingText(exported.counts)}; wrote nothing\n`);
    return 1;
  }
  writeFileSync(file, encodeBundle(exported.bundle));
  io.stdout(`${countsText(exported.counts, file)}\n`);
  return 0;
}

/** Which runners `parts` record; why not when they record Vitest and it does not resolve here. */
function recordedRunners(
  root: AbsolutePath,
  parts: readonly NamedPart[],
): { readonly vitest: boolean; readonly nodeTest: boolean } | string {
  const vitest = parts.some(({ part }) => !isNodeTest(part));
  if (vitest && !vitestResolves(root)) {
    return `the parts record Vitest, and vitest does not resolve from ${root}`;
  }
  return { vitest, nodeTest: parts.some(({ part }) => isNodeTest(part)) };
}

function fail(say: (text: string) => void, text: string): number {
  say(text);
  return 1;
}

function parseExport(args: readonly string[]): ExportArgs | { readonly error: string } {
  const parts: string[] = [];
  let out: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string;
    if (arg === "--parts") {
      const before = parts.length;
      while (i + 1 < args.length && !(args[i + 1] as string).startsWith("--")) {
        parts.push(args[++i] as string);
      }
      if (parts.length === before) return { error: "--parts names no directory" };
    } else if (arg.startsWith("--parts=")) {
      const value = arg.slice("--parts=".length);
      if (value === "") return { error: "--parts names no directory" };
      parts.push(value);
    } else if (arg === "--out" || arg.startsWith("--out=")) {
      const value = arg === "--out" ? args[++i] : arg.slice("--out=".length);
      if (value === undefined || value === "") return { error: "--out names no file" };
      out = value;
    } else return { error: `unknown argument "${arg}"` };
  }
  if (parts.length === 0) return { error: "no --parts: name the directories the shards wrote" };
  return { parts, out };
}

/**
 * The adapters a daemon builds here for the runners the parts record:
 * Vitest's (`daemonVitest`), and one per `nodeTest` entry the daemon opens
 * (spec 018 D26; an entry with a `prepare` it does not open, 020 D15.6),
 * with coverage as the daemon keys it. An entry with a `container` keys
 * in that target's space, as this job inside its image shows it
 * (`containerKeyOf`). Closes those it opened when one rejects.
 */
async function daemonRunners(
  root: AbsolutePath,
  policy: Policy,
  temp: AbsolutePath,
  recorded: { readonly vitest: boolean; readonly nodeTest: boolean },
  job: { readonly squealVersion: string; readonly env: NodeJS.ProcessEnv },
): Promise<RunnerAdapter[]> {
  const adapters: RunnerAdapter[] = [];
  let probed: Promise<ContainerProbe> | undefined;
  const probe = () => {
    probed ??= probeLocalContainer();
    return probed;
  };
  try {
    if (recorded.vitest) adapters.push(await daemonVitest(root, policy, temp));
    if (!recorded.nodeTest) return adapters;
    const coverage = {
      enabled: () => coverageOn(policy),
      children: () => policy.coverage.children,
      collected: () => {},
    };
    for (const project of policy.nodeTest.filter((p) => p.prepare === undefined)) {
      const key = await containerKeyOf(project, { root, policy, probe, ...job });
      const adapter = await createNodeTestAdapter(project, {
        root,
        concurrency: () => policy.runner.tierSize,
        inputs: () => policy.inputs,
        tempDir: temp,
        coverage,
      });
      adapters.push(key === null ? adapter : wrapContainerEnvironmentAdapter(adapter, key));
    }
    return adapters;
  } catch (error) {
    await Promise.allSettled(adapters.map((a) => a.close()));
    throw error;
  }
}

/**
 * Spec 027 D7.2, review 0.1.644 B3: the key a job inside `project`'s
 * container target gives its environments (`localContainerKey`), so its
 * export matches a developer's managed run of the same build; `null` for a
 * host entry, or one whose target the policy does not hold.
 */
async function containerKeyOf(
  project: NodeTestProject,
  here: {
    readonly root: AbsolutePath;
    readonly policy: Policy;
    readonly probe: () => Promise<ContainerProbe>;
    readonly squealVersion: string;
    readonly env: NodeJS.ProcessEnv;
  },
): Promise<ContainerKey | null> {
  if (project.container === undefined) return null;
  const target = ownValue(here.policy.containers, project.container);
  return target === undefined ? null : localContainerKey({ target, ...here });
}

/**
 * The Vitest adapter as the daemon builds it from `policy`
 * (`daemonVitestOptions`), which the environment hash holds. Coverage is
 * never collected here: the export runs no test.
 */
function daemonVitest(
  root: AbsolutePath,
  policy: Policy,
  temp: AbsolutePath,
): Promise<RunnerAdapter> {
  return createVitestAdapter(
    daemonVitestOptions({
      root,
      policy: () => policy,
      provider: coverageProvider(),
      tempDir: temp,
    }),
  );
}

const files = (n: number) => `${n} test file${n === 1 ? "" : "s"}`;

/** What the export wrote, and the files left out by reason. */
export function countsText(counts: CiExportCounts, file: string): string {
  const results = `${counts.results} result${counts.results === 1 ? "" : "s"}`;
  const left = leftOut(counts);
  const leftText = left.length === 0 ? "" : `\nLeft out: ${left}.`;
  return `Exported ${files(counts.testFiles)}, ${results}, to ${file}.${endsText(counts)}${leftText}`;
}

/**
 * Spec 018 D33: how much of the export rests on inputs nothing in their
 * shard's command touched, certified by hashes at its start and end.
 */
function endsText({ endpoints }: CiExportCounts): string {
  if (endpoints === 0) return "";
  const verb = endpoints === 1 ? "rests" : "rest";
  return `\n${endpoints} of them ${verb} on inputs that nothing in their shard's command read, listed or wrote, certified by equal hashes at the command's start and end.`;
}

const nameOf = (testFile: { readonly project: string; readonly path: string }): string =>
  `${testFile.project === "" ? "" : `${testFile.project}:`}${testFile.path}`;

/** Files named in the lines `uncertifiedLines` gives; the count says the rest. */
const NAMED_FILES = 3;

/** For the first few files left out uncertified, the inputs whose content here is not their shard's. */
function uncertifiedLines(files: readonly UncertifiedFile[]): string[] {
  return files.slice(0, NAMED_FILES).map(({ testFile, inputs }) => {
    const name = nameOf(testFile);
    const shown = inputs.slice(0, NAMED_FILES).join(", ");
    const more = inputs.length > NAMED_FILES ? ` and ${inputs.length - NAMED_FILES} more` : "";
    return `left out ${name}: its shard recorded other content, or none, for ${shown}${more}`;
  });
}

/** Why the export holds no file. */
export function nothingText(counts: CiExportCounts): string {
  const left = leftOut(counts);
  return `no test file to export${left.length === 0 ? "" : `; left out: ${left}`}`;
}

/** The files left out, by reason; empty when none. */
function leftOut(counts: CiExportCounts): string {
  return [
    counts.failed > 0 ? `${files(counts.failed)} that failed in a shard` : null,
    counts.unkeyed > 0 ? `${files(counts.unkeyed)} this checkout could not key` : null,
    counts.uncertified > 0
      ? `${files(counts.uncertified)} whose inputs here are not what their shard read`
      : null,
    counts.ambiguous > 0 ? `${files(counts.ambiguous)} with two checks of one name` : null,
    counts.inspector > 0
      ? `${files(counts.inspector)} that loaded node:inspector beside a coverage provider`
      : null,
    counts.unwatched > 0
      ? `${files(counts.unwatched)} whose node:inspector use could not be watched (as in a vmThreads pool)`
      : null,
    counts.absolute > 0
      ? `${files(counts.absolute)} that ${counts.absolute === 1 ? "holds" : "hold"} an absolute path`
      : null,
    counts.nodeTestLeftOut > 0
      ? `${files(counts.nodeTestLeftOut)} of node:test that no nodeTest entry here takes as its own run`
      : null,
  ]
    .filter((part) => part !== null)
    .join(", ");
}
