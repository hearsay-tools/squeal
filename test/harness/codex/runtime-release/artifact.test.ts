import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  packRuntime,
  RuntimeReleaseError,
  stageRuntimeArtifact,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { envelopeOf, gz, runtimeTree, snapshot } from "./fixture.js";

/*
 * Row 002-30 (spec 002 D8, wave-4-contract.md): a runtime tree packs into
 * the same gzip-compressed JSON envelope every time, stages back byte for
 * byte with its modes, and a modified byte is rejected before anything is
 * written outside memory.
 */

const V = "0.1.900";

/** The error `fn` throws, which must be a `RuntimeReleaseError`. */
function failure(fn: () => unknown): RuntimeReleaseError {
  try {
    fn();
  } catch (error) {
    if (error instanceof RuntimeReleaseError) return error;
    throw error;
  }
  throw new Error("expected a RuntimeReleaseError");
}

describe("packRuntime and stageRuntimeArtifact", () => {
  it("packs deterministically and stages the same files with their modes", () => {
    const source = runtimeTree(V);
    const first = packRuntime(source);
    const second = packRuntime(source);
    expect(first.artifact.equals(second.artifact)).toBe(true);
    expect(first.version).toBe(V);
    expect(first.sha256).toBe(createHash("sha256").update(first.artifact).digest("hex"));
    expect(gunzipSync(first.artifact).equals(first.envelope)).toBe(true);

    const staging = join(tempDir(), "staging");
    const staged = stageRuntimeArtifact({
      artifact: first.artifact,
      sha256: first.sha256,
      expectedVersion: V,
      stagingDir: staging,
    });
    expect(staged.version).toBe(V);
    expect(staged.root.startsWith(`${staging}/`)).toBe(true);
    expect(snapshot(staged.root)).toEqual(snapshot(source));
    expect(snapshot(staged.root).get("bin/squeal-launcher")?.mode).toBe(0o755);
    expect(snapshot(staged.root).get("skills/squeal/SKILL.md")?.mode).toBe(0o644);

    staged.cleanup();
    staged.cleanup();
    expect(readdirSync(staging)).toEqual([]);
  });

  it("rejects a modified byte in a file before staging anything", () => {
    const source = runtimeTree(V);
    const envelope = envelopeOf(source, V);
    const target = envelope.files.find((file) => file.path === "dist/runtime.mjs");
    if (target === undefined) throw new Error("fixture lacks dist/runtime.mjs");
    const bytes = Buffer.from(target.data, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    target.data = bytes.toString("base64");

    const staging = join(tempDir(), "staging");
    const error = failure(() =>
      stageRuntimeArtifact({ artifact: gz(envelope), stagingDir: staging }),
    );
    expect(error.code).toBe("runtime");
    expect(error.message).toContain("dist/runtime.mjs");
    expect(existsSync(staging)).toBe(false);
  });

  it("rejects artifact bytes that do not match the expected SHA-256", () => {
    const packed = packRuntime(runtimeTree(V));
    const changed = Buffer.from(packed.artifact);
    changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
    const staging = join(tempDir(), "staging");
    const error = failure(() =>
      stageRuntimeArtifact({ artifact: changed, sha256: packed.sha256, stagingDir: staging }),
    );
    expect(error.code).toBe("integrity");
    expect(existsSync(staging)).toBe(false);
  });
});
