import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { packRuntime } from "../src/harness/codex/runtime-release/artifact.js";
import {
  RUNTIME_ARTIFACT_ASSET,
  RUNTIME_DESCRIPTOR_ASSET,
} from "../src/harness/codex/runtime-release/descriptor.js";
import {
  isRuntimeVersion,
  REQUIRED_ENTRIES,
} from "../src/harness/codex/runtime-release/manifest.js";
import { runtimeTree, snapshot } from "./harness/codex/runtime-release/fixture.js";
import { tempDir } from "./store/helpers.js";

/*
 * Spec 020 D9 (row 020-11): the README's "The quality check in CI" installs
 * a pinned Squeal with no harness. No Squeal command can unpack the release's
 * runtime asset before Squeal is there, so the job's `Install Squeal` step
 * carries a short Node script that checks the asset's SHA-256 against the
 * pinned one and unpacks it; the CLI is then `dist/cli/squeal.mjs`. These
 * tests run that script as the README spells it on an artifact `packRuntime`
 * makes, so a change of the artifact's format that the script cannot read
 * fails here.
 */

const README = readFileSync(resolve(import.meta.dirname, "../README.md"), "utf8");

/** The README's section, from its heading to the next `## ` heading. */
function section(): string {
  const start = README.indexOf("\n## The quality check in CI\n");
  expect(start).toBeGreaterThan(-1);
  const end = README.indexOf("\n## ", start + 1);
  return README.slice(start, end === -1 ? undefined : end);
}

/** The section's GitHub Actions job, as text. */
function job(): string {
  const yaml = /```yaml\n([\s\S]*?)```/.exec(section())?.[1];
  expect(yaml).toBeDefined();
  return yaml ?? "";
}

/** The `node -e '<script>'` of the job's `Install Squeal` step. */
function unpackScript(): string {
  const script = /node -e '([^']*)' "\$file" "\$SQUEAL_SHA256" "\$RUNNER_TEMP\/squeal"/.exec(
    job(),
  )?.[1];
  expect(script).toBeDefined();
  return script ?? "";
}

/** Runs the README's script on `file`, pinned to `sha256`, into `out`. */
function unpack(file: string, sha256: string, out: string) {
  return spawnSync(process.execPath, ["-e", unpackScript(), file, sha256, out], {
    encoding: "utf8",
  });
}

/** A packed fixture runtime, written as the release asset. */
function asset(): { source: string; file: string; sha256: string } {
  const source = runtimeTree("0.1.900");
  const packed = packRuntime(source);
  const file = join(tempDir("squeal-readme-ci-"), RUNTIME_ARTIFACT_ASSET);
  writeFileSync(file, packed.artifact);
  return { source, file, sha256: packed.sha256 };
}

/** Each file's bytes and whether it is executable; modes otherwise follow the umask. */
const files = (root: string) =>
  [...snapshot(root)].map(([path, { mode, bytes }]) => [path, bytes, (mode & 0o100) !== 0]);

describe("the README's pinned CI install", () => {
  it("unpacks the pinned asset byte for byte, and its CLI starts", () => {
    const { source, file, sha256 } = asset();
    const out = join(tempDir("squeal-readme-ci-out-"), "squeal");
    const result = unpack(file, sha256, out);
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(files(out)).toEqual(files(source));
    const cli = spawnSync(process.execPath, [join(out, "dist/cli/squeal.mjs")], {
      encoding: "utf8",
    });
    expect(cli.stdout).toBe("squeal\n");
  });

  it("refuses an asset whose SHA-256 is not the pinned one, and writes nothing", () => {
    const { file, sha256 } = asset();
    const out = join(tempDir("squeal-readme-ci-out-"), "squeal");
    const wrong = unpack(file, "0".repeat(64), out);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toBe(`${file} has SHA-256 ${sha256}, not ${"0".repeat(64)}: refused\n`);
    expect(existsSync(out)).toBe(false);

    writeFileSync(file, Buffer.concat([readFileSync(file), Buffer.from("x")]));
    const changed = unpack(file, sha256, out);
    expect(changed.status).toBe(1);
    expect(changed.stderr).toMatch(/has SHA-256 [0-9a-f]{64}, not [0-9a-f]{64}: refused\n$/);
    expect(existsSync(out)).toBe(false);
  });

  it("refuses to unpack into a directory that exists", () => {
    const { file, sha256 } = asset();
    const out = join(tempDir("squeal-readme-ci-out-"), "squeal");
    mkdirSync(out);
    expect(unpack(file, sha256, out).status).not.toBe(0);
    expect(readdirSync(out)).toEqual([]);
  });

  it("pins the version and SHA-256, keys the cache on both, and runs a required entry", () => {
    const text = job();
    const version = /^\s+SQUEAL_VERSION: (\S+)$/m.exec(text)?.[1];
    expect(isRuntimeVersion(version)).toBe(true);
    expect(text).toMatch(/^\s+SQUEAL_SHA256: [0-9a-f]{64}$/m);
    expect(text).toMatch(
      /^\s+key: squeal-runtime-\$\{\{ env\.SQUEAL_VERSION \}\}-\$\{\{ env\.SQUEAL_SHA256 \}\}$/m,
    );
    expect(text).toContain(`/squeal--v$SQUEAL_VERSION/${RUNTIME_ARTIFACT_ASSET}"`);
    expect(text).toContain(`"$RUNNER_TEMP/squeal/dist/cli/squeal.mjs" code --base`);
    expect(REQUIRED_ENTRIES).toContain("dist/cli/squeal.mjs");
    expect(section()).toContain(`/squeal--v${version}/${RUNTIME_DESCRIPTOR_ASSET}\n`);
  });
});
