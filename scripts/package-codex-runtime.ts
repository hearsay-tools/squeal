import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createReleaseDescriptor,
  packRuntime,
  RELEASE_REPOSITORY,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  releaseTagFor,
  serializeReleaseDescriptor,
} from "../src/harness/codex/runtime-release/index.js";

/*
 * Spec 002 D8, `tasks/wave-5-contract.md` (row 002-31): the two Codex runtime
 * assets of one release, from its exact release commit. The runtime tree is
 * read as that commit holds it, file by file from git, never from the
 * working tree, then validated and packed; the descriptor binds the artifact
 * to the commit. Nothing is published: the upload commands are written
 * beside the assets for whoever publishes the release.
 *
 *   pnpm run package:codex-runtime -- --commit <full commit hash> --out <dir>
 */

/** The committed current runtime the build writes (`src/harness/codex/build.ts`). */
export const RUNTIME_TREE = "plugins/codex-runtime";
/** The upload commands, written beside the assets. */
export const UPLOAD_NOTES = "UPLOAD.md";

export interface PackageRuntimeOptions {
  /** The release commit, its full lowercase hash. */
  readonly commit: string;
  /** Where the assets are written; none of the three files may exist there yet. */
  readonly out: string;
  /** The repository; the process's directory by default. */
  readonly cwd?: string;
}

export interface PackagedRuntime {
  readonly version: string;
  readonly tag: string;
  readonly commit: string;
  readonly sha256: string;
  /** Absolute paths of the artifact, the descriptor and the upload notes. */
  readonly files: readonly string[];
}

const git = (cwd: string, args: readonly string[]): Buffer =>
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 << 20 });

/** Writes `RUNTIME_TREE` as `commit` holds it under `stage`; returns the tree's root there. */
function checkout(cwd: string, commit: string, stage: string): string {
  const listing = git(cwd, ["ls-tree", "-r", "-z", "--full-tree", commit, "--", RUNTIME_TREE]);
  const entries = listing.toString("utf8").split("\0").filter(Boolean);
  if (entries.length === 0) throw new Error(`${commit} has no ${RUNTIME_TREE}`);
  for (const entry of entries) {
    const [meta = "", path = ""] = entry.split("\t");
    const [mode, type, object = ""] = meta.split(" ");
    if (type !== "blob" || (mode !== "100644" && mode !== "100755")) {
      throw new Error(`${path} at ${commit} is a ${mode} ${type}, not a regular file`);
    }
    const target = join(stage, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git(cwd, ["cat-file", "blob", object]));
    chmodSync(target, mode === "100755" ? 0o755 : 0o644);
  }
  return join(stage, RUNTIME_TREE);
}

/** The upload commands for the release `tag` of `commit`, run in the assets' directory. */
function uploadNotes(packed: Omit<PackagedRuntime, "files">): string {
  return `# Squeal Codex runtime ${packed.version}

Packed from commit ${packed.commit}: \`${RUNTIME_TREE}\` as that commit holds it. Nothing was published.

Upload both assets to the release \`${packed.tag}\` of ${RELEASE_REPOSITORY}, whose tag must name that commit. In this directory:

\`\`\`sh
test "$(git rev-parse '${packed.tag}^{commit}')" = ${packed.commit}
gh release upload '${packed.tag}' ${RUNTIME_ARTIFACT_ASSET} ${RUNTIME_DESCRIPTOR_ASSET} --repo ${RELEASE_REPOSITORY}
\`\`\`

The first command runs in a clone of ${RELEASE_REPOSITORY}. Never replace an uploaded asset: its SHA-256, ${packed.sha256}, is in the descriptor.
`;
}

/**
 * Packs the runtime of the exact release commit into `out`. Throws when the
 * commit is no full hash of a commit here, holds no runtime tree or a link
 * in it, the tree is not a complete runtime, its version is not the
 * commit's root version, or an output file exists.
 */
export function packageCodexRuntime(options: PackageRuntimeOptions): PackagedRuntime {
  const cwd = options.cwd ?? process.cwd();
  const { commit } = options;
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`the release commit must be a full lowercase commit hash, not ${commit}`);
  }
  let resolved: string;
  try {
    resolved = git(cwd, ["rev-parse", "--verify", "--quiet", `${commit}^{commit}`])
      .toString("utf8")
      .trim();
  } catch {
    throw new Error(`${commit} is no commit of the repository at ${cwd}`);
  }
  if (resolved !== commit) throw new Error(`${commit} resolves to ${resolved}`);
  const out = resolve(cwd, options.out);
  const files = [RUNTIME_ARTIFACT_ASSET, RUNTIME_DESCRIPTOR_ASSET, UPLOAD_NOTES].map((f) =>
    join(out, f),
  );
  const existing = files.filter((file) => existsSync(file));
  if (existing.length > 0) throw new Error(`${existing.join(", ")} already exists`);
  const rootVersion = String(
    (
      JSON.parse(git(cwd, ["show", `${commit}:package.json`]).toString("utf8")) as {
        version: unknown;
      }
    ).version,
  );
  const stage = mkdtempSync(join(tmpdir(), "squeal-runtime-package-"));
  try {
    const packed = packRuntime(checkout(cwd, commit, stage));
    if (packed.version !== rootVersion) {
      throw new Error(`${RUNTIME_TREE} at ${commit} is ${packed.version}, not ${rootVersion}`);
    }
    const descriptor = createReleaseDescriptor({
      version: packed.version,
      sha256: packed.sha256,
      releaseCommit: commit,
    });
    const result = { version: packed.version, tag: releaseTagFor(packed.version), commit };
    mkdirSync(out, { recursive: true });
    const [artifact = "", described = "", notes = ""] = files;
    writeFileSync(artifact, packed.artifact);
    writeFileSync(described, serializeReleaseDescriptor(descriptor));
    writeFileSync(notes, uploadNotes({ ...result, sha256: packed.sha256 }));
    return { ...result, sha256: packed.sha256, files };
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

/** `--commit <hash> --out <dir>`, each once. */
export function parseArgs(argv: readonly string[]): { commit: string; out: string } {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i] ?? "";
    const value = argv[i + 1];
    if (!["--commit", "--out"].includes(flag) || value === undefined || flag in values) {
      throw new Error("usage: package-codex-runtime --commit <full commit hash> --out <dir>");
    }
    values[flag] = value;
  }
  const commit = values["--commit"];
  const out = values["--out"];
  if (commit === undefined || out === undefined) {
    throw new Error("usage: package-codex-runtime --commit <full commit hash> --out <dir>");
  }
  return { commit, out };
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2).filter((arg, i) => !(i === 0 && arg === "--"));
    const packed = packageCodexRuntime(parseArgs(args));
    console.log(`packaged ${packed.tag} from ${packed.commit}: ${packed.files.join(", ")}`);
  } catch (error) {
    console.error(`package-codex-runtime: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
