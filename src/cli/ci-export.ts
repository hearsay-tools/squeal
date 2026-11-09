import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type CiExportCounts, ciExport } from "../core/ci/export.js";
import type { NamedPart } from "../core/ci/export-check.js";
import { PART_PREFIX, readPart } from "../core/ci/parts.js";
import { coverageOn, coverageProvider } from "../core/code/coverage/runtime.js";
import { readPolicy } from "../core/daemon/policy.js";
import { squealVersion } from "../core/daemon/version.js";
import { readHead } from "../core/daemon-loop/head.js";
import { findWorktreeRoot, worktreeIdFor } from "../core/fs/git-layout.js";
import { KEY_FORMAT_VERSION } from "../core/keys/key-format.js";
import { isStoreOpenFailure, openStore } from "../core/store/open.js";
import { AbsolutePathError } from "../core/store/transfer.js";
import { encodeBundle } from "../core/store/transfer-bundle.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { Policy } from "../core/types/policy.js";
import type { RunnerAdapter } from "../core/types/runner.js";
import { vitestResolves } from "../runners/vitest/ci-record.js";
import { createVitestAdapter } from "../runners/vitest/index.js";
import { sourceOf } from "./export.js";
import type { CliIo } from "./main.js";

export const EXPORT_USAGE = "usage: squeal ci export --parts <dir>... [--out <file>]\n";

interface ExportArgs {
  readonly parts: readonly string[];
  readonly out: string | null;
}

/**
 * `squeal ci export --parts <dir>... [--out <file>]` (spec 018 D9): in a
 * fresh checkout of the shards' commit, after every shard passed, writes the
 * D2 export of the parts in each `<dir>` (`squeal ci record`'s), keyed as a
 * daemon in this checkout keys, to `--out` (default
 * `squeal-results-<commit8>.json.gz`). Exit 0 when it wrote the file, 1 when
 * it refused the parts or had nothing to write, 2 on a usage error.
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
  const parts = readParts(parsed.parts.map((dir) => resolve(cwd, dir)));
  if (typeof parts === "string") return fail(say, parts);
  if (!vitestResolves(root)) {
    return fail(say, `only Vitest is supported, and vitest does not resolve from ${root}`);
  }
  const policy = readPolicy(root);
  const head = await readHead(root);
  const header = {
    squealVersion: squealVersion(),
    keyFormat: KEY_FORMAT_VERSION,
    commit: head.head,
    dirty: head.dirty,
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
      runner: () => daemonVitest(root, policy, temp),
      policy,
      squealVersion: header.squealVersion,
      env: { ...(io.env ?? process.env) },
      parts,
      header,
      now: io.now ?? Date.now,
    });
    if ("refused" in exported) return fail(say, `refused: ${exported.refused.text}`);
    if (exported.counts.testFiles === 0) {
      return fail(say, `no test file that passed in the parts could be keyed here`);
    }
    const commit8 = header.commit === null ? "unborn" : header.commit.slice(0, 8);
    const file = resolve(cwd, parsed.out ?? `squeal-results-${commit8}.json.gz`);
    writeFileSync(file, encodeBundle(exported.bundle));
    io.stdout(`${countsText(exported.counts, file)}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof AbsolutePathError)) throw error;
    return fail(say, error.message);
  } finally {
    if (!isStoreOpenFailure(store)) store.close();
    rmSync(temp, { recursive: true, force: true });
  }
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

/** The parts in `dirs`, or why there is none to export. */
function readParts(dirs: readonly AbsolutePath[]): NamedPart[] | string {
  const parts: NamedPart[] = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) return `no directory ${dir}`;
    const names = readdirSync(dir).filter((n) => n.startsWith(PART_PREFIX) && n.endsWith(".json"));
    for (const name of names.sort()) {
      const file = join(dir, name);
      const part = readPart(file);
      if (typeof part === "string") return part;
      parts.push({ file, part });
    }
  }
  return parts.length > 0 ? parts : `no part (${PART_PREFIX}*.json) in ${dirs.join(", ")}`;
}

/**
 * The Vitest adapter as the daemon builds it from `policy` (`daemon.ts`):
 * observing, the excluded projects and files, and Squeal's coverage provider
 * when coverage is on, which the environment hash holds. Coverage is never
 * collected here: the export runs no test.
 */
function daemonVitest(
  root: AbsolutePath,
  policy: Policy,
  temp: AbsolutePath,
): Promise<RunnerAdapter> {
  const provider = coverageOn(policy) ? coverageProvider() : null;
  return createVitestAdapter({
    root,
    observe: () => policy.observe.runtimeInputs,
    excludeProjects: () => policy.vitest.excludeProjects,
    exclude: () => policy.vitest.exclude,
    ...(provider === null
      ? {}
      : { coverage: { enabled: () => true, provider, tempDir: temp, collected: () => {} } }),
  });
}

const files = (n: number) => `${n} test file${n === 1 ? "" : "s"}`;

/** What the export wrote, and the files left out by reason. */
export function countsText(counts: CiExportCounts, file: string): string {
  const results = `${counts.results} result${counts.results === 1 ? "" : "s"}`;
  const left = [
    counts.failed > 0 ? `${files(counts.failed)} that failed in a shard` : null,
    counts.unkeyed > 0 ? `${files(counts.unkeyed)} this checkout could not key` : null,
  ].filter((part) => part !== null);
  const leftText = left.length === 0 ? "" : `\nLeft out: ${left.join(", ")}.`;
  return `Exported ${files(counts.testFiles)}, ${results}, to ${file}.${leftText}`;
}
