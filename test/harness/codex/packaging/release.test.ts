import { execFileSync } from "node:child_process";
import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  packageCodexRuntime,
  parseArgs,
  RUNTIME_TREE,
  UPLOAD_NOTES,
} from "../../../../scripts/package-codex-runtime.js";
import {
  decodeRuntimeArtifact,
  parseReleaseDescriptor,
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
  stageRuntimeArtifact,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { git, initRepo, tempDir } from "../../../hash/git-repo.js";
import { runtimeTree } from "../adapter/fixture.js";
import { snapshotTree } from "./fixture.js";

/*
 * Row 002-31 (spec 002 D8): the release packager writes both runtime assets
 * of the exact release commit, from that commit's tree, never the working
 * tree, and publishes nothing.
 */

const V = "0.1.900";
const pkg = (version: string) => `${JSON.stringify({ name: "squeal", version })}\n`;

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function scratch(prefix: string): string {
  const dir = tempDir(prefix);
  cleanups.push(dir.cleanup);
  return dir.path;
}

/** A repository whose one commit holds package.json at `root` and a runtime tree of `runtime`. */
function repo(root = V, runtime = V): { dir: string; commit: string } {
  const dir = scratch("squeal-release-repo-");
  initRepo(dir, { "package.json": pkg(root) });
  runtimeTree(join(dir, RUNTIME_TREE), runtime);
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "runtime"]);
  return { dir, commit: git(dir, ["rev-parse", "HEAD"]).trim() };
}

describe("packaging the runtime of a release commit", () => {
  it("writes the artifact, the descriptor bound to the commit, and the upload commands", () => {
    const { dir, commit } = repo();
    const out = join(scratch("squeal-release-out-"), "assets");
    const packed = packageCodexRuntime({ commit, out, cwd: dir });
    expect(packed).toMatchObject({ version: V, tag: `squeal--v${V}`, commit });

    const artifact = readFileSync(join(out, RUNTIME_ARTIFACT_ASSET));
    const descriptor = parseReleaseDescriptor(
      readFileSync(join(out, RUNTIME_DESCRIPTOR_ASSET), "utf8"),
      `squeal--v${V}`,
    );
    expect(descriptor).toMatchObject({ version: V, releaseCommit: commit, sha256: packed.sha256 });
    const staged = stageRuntimeArtifact({
      artifact,
      sha256: descriptor.sha256,
      expectedVersion: V,
      stagingDir: scratch("squeal-release-stage-"),
    });
    expect(snapshotTree(staged.root)).toEqual(snapshotTree(join(dir, RUNTIME_TREE)));

    const notes = readFileSync(join(out, UPLOAD_NOTES), "utf8");
    expect(notes).toContain(`test "$(git rev-parse 'squeal--v${V}^{commit}')" = ${commit}\n`);
    expect(notes).toContain(
      `gh release upload 'squeal--v${V}' ${RUNTIME_ARTIFACT_ASSET} ${RUNTIME_DESCRIPTOR_ASSET} --repo hearsay-tools/squeal\n`,
    );
    expect(notes).toContain("Nothing was published.");
  });

  it("packs the commit's tree, not the working tree, and the same commit packs the same bytes", () => {
    const { dir, commit } = repo();
    const first = packageCodexRuntime({ commit, out: scratch("squeal-release-a-"), cwd: dir });
    writeFileSync(join(dir, RUNTIME_TREE, "dist", "runtime.mjs"), "// edited, not committed\n");
    const second = packageCodexRuntime({ commit, out: scratch("squeal-release-b-"), cwd: dir });
    expect(second.sha256).toBe(first.sha256);
    const files = (p: typeof first) => decodeRuntimeArtifact(readFileSync(p.files[0] ?? "")).files;
    const entry = files(second).find((f) => f.path === "dist/runtime.mjs");
    expect(entry?.bytes.toString("utf8")).toContain("runRuntimeHook");
  });

  it("refuses a short or unknown commit, a commit without the tree, and a version mismatch", () => {
    const { dir, commit } = repo(V, "0.1.899");
    const out = scratch("squeal-release-out-");
    expect(() => packageCodexRuntime({ commit: commit.slice(0, 12), out, cwd: dir })).toThrow(
      /full lowercase commit hash/,
    );
    expect(() => packageCodexRuntime({ commit: "f".repeat(40), out, cwd: dir })).toThrow(
      /is no commit/,
    );
    expect(() => packageCodexRuntime({ commit, out, cwd: dir })).toThrow(
      /plugins\/codex-runtime at .* is 0\.1\.899, not 0\.1\.900/,
    );
    const bare = scratch("squeal-release-bare-");
    initRepo(bare, { "package.json": pkg(V) });
    const none = git(bare, ["rev-parse", "HEAD"]).trim();
    expect(() => packageCodexRuntime({ commit: none, out, cwd: bare })).toThrow(
      /has no plugins\/codex-runtime/,
    );
  });

  it("refuses a link in the committed tree and an output file that exists", () => {
    const { dir } = repo();
    symlinkSync("SKILL.md", join(dir, RUNTIME_TREE, "skills", "squeal", "link.md"));
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-q", "-m", "link"]);
    const linked = git(dir, ["rev-parse", "HEAD"]).trim();
    const out = scratch("squeal-release-out-");
    expect(() => packageCodexRuntime({ commit: linked, out, cwd: dir })).toThrow(
      /link\.md at .* is a 120000 blob, not a regular file/,
    );
    const clean = repo();
    writeFileSync(join(out, RUNTIME_DESCRIPTOR_ASSET), "{}\n");
    expect(() => packageCodexRuntime({ commit: clean.commit, out, cwd: clean.dir })).toThrow(
      /already exists/,
    );
  });
});

describe("the packager command", () => {
  it("takes --commit and --out once each", () => {
    expect(parseArgs(["--commit", "c", "--out", "o"])).toEqual({ commit: "c", out: "o" });
    for (const argv of [[], ["--commit", "c"], ["--commit", "c", "--commit", "d"], ["--x", "y"]]) {
      expect(() => parseArgs(argv), argv.join(" ")).toThrow(/usage/);
    }
  });

  it("runs as pnpm runs it, writing the assets and exiting 0", () => {
    const { dir, commit } = repo();
    const out = join(scratch("squeal-release-cli-"), "assets");
    const script = join(import.meta.dirname, "../../../../scripts/package-codex-runtime.ts");
    const tsx = join(import.meta.dirname, "../../../../node_modules/.bin/tsx");
    const stdout = execFileSync(tsx, [script, "--", "--commit", commit, "--out", out], {
      cwd: dir,
      encoding: "utf8",
    });
    expect(stdout).toContain(`packaged squeal--v${V} from ${commit}`);
    expect(readFileSync(join(out, RUNTIME_DESCRIPTOR_ASSET), "utf8")).toContain(commit);
  }, 60_000);
});
