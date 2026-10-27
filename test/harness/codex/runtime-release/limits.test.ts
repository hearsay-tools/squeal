import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_RUNTIME_LIMITS,
  packRuntime,
  type RuntimeArtifactLimits,
  type RuntimeReleaseErrorCode,
  stageRuntimeArtifact,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { envelopeOf, failure, gz, put, runtimeTree, snapshot, writeManifest } from "./fixture.js";

/*
 * Row 002-30 (wave-4-contract.md): compressed, decompressed, per-file,
 * total and count bounds hold before staging; a truncated or non-gzip
 * payload is refused; and the committed Codex plugin, made runtime-shaped,
 * roundtrips within the default bounds with room to grow.
 */

const V = "0.1.900";
const CODEX_PLUGIN = fileURLToPath(new URL("../../../../plugins/codex", import.meta.url));
const limits = (over: Partial<RuntimeArtifactLimits>): RuntimeArtifactLimits => ({
  ...DEFAULT_RUNTIME_LIMITS,
  ...over,
});

function refused(artifact: Uint8Array, code: RuntimeReleaseErrorCode, text: string, bound = {}) {
  const stagingDir = join(tempDir(), "staging");
  const error = failure(() =>
    stageRuntimeArtifact({ artifact, stagingDir, limits: limits(bound) }),
  );
  expect({ code: error.code, message: error.message }).toEqual({
    code,
    message: expect.stringContaining(text),
  });
  expect(existsSync(stagingDir)).toBe(false);
}

describe("artifact bounds", () => {
  const packed = () => packRuntime(runtimeTree(V));

  it("refuses compressed bytes over the bound before inflating", () => {
    const { artifact } = packed();
    refused(artifact, "too-large", `over ${artifact.byteLength - 1}`, {
      maxArtifactBytes: artifact.byteLength - 1,
    });
  });

  it("stops inflating at the envelope bound", () => {
    const bomb = gzipSync(Buffer.alloc(8 * 2 ** 20, 0x20));
    expect(bomb.byteLength).toBeLessThan(64 * 1024);
    refused(bomb, "too-large", "inflates past", { maxEnvelopeBytes: 2 ** 20 });
  });

  it("refuses too many files, one file too large, and files too large together", () => {
    const { artifact, envelope } = packed();
    const count = JSON.parse(envelope.toString()).files.length;
    refused(artifact, "too-large", `has ${count} files, over ${count - 1}`, {
      maxFiles: count - 1,
    });
    refused(artifact, "too-large", "dist/code/grammar.wasm is over 255 bytes", {
      maxFileBytes: 255,
    });
    refused(artifact, "too-large", "files exceed 300 bytes", { maxTotalBytes: 300 });
  });

  it("refuses a truncated payload, an empty one, plain JSON and gzip of non-JSON", () => {
    const { artifact, envelope } = packed();
    refused(artifact.subarray(0, artifact.byteLength - 9), "artifact", "not valid gzip");
    refused(artifact.subarray(0, 40), "artifact", "not valid gzip");
    refused(new Uint8Array(), "artifact", "not valid gzip");
    refused(envelope, "artifact", "not valid gzip");
    refused(gzipSync(Buffer.from("{")), "artifact", "not JSON");
    refused(gz([]), "artifact", "exactly schema, version and files");
  });
});

describe("the committed Codex plugin as a runtime", () => {
  it("roundtrips byte for byte within a quarter of the default bounds", () => {
    const root = join(tempDir("squeal-runtime-real-"), "runtime");
    cpSync(CODEX_PLUGIN, root, { recursive: true });
    const version: string = JSON.parse(
      readFileSync(join(root, ".codex-plugin/plugin.json"), "utf8"),
    ).version;
    // Until the packaging row adds it, the dispatch entry is a stand-in.
    put(root, "dist/runtime.mjs", "export async function runRuntimeHook() {}\n");
    writeManifest(root, version);

    const packed = packRuntime(root);
    const files = envelopeOf(root, version).files.length;
    expect(packed.envelope.byteLength * 4).toBeLessThan(DEFAULT_RUNTIME_LIMITS.maxEnvelopeBytes);
    expect(packed.artifact.byteLength * 4).toBeLessThan(DEFAULT_RUNTIME_LIMITS.maxArtifactBytes);
    expect(files * 4).toBeLessThan(DEFAULT_RUNTIME_LIMITS.maxFiles);

    const stagingDir = join(tempDir(), "staging");
    const staged = stageRuntimeArtifact({
      artifact: packed.artifact,
      sha256: packed.sha256,
      expectedVersion: version,
      stagingDir,
    });
    const normalized = (tree: ReturnType<typeof snapshot>) =>
      new Map(
        [...tree].map(([path, file]) => [
          path,
          { ...file, mode: file.mode & 0o111 ? 0o755 : 0o644 },
        ]),
      );
    expect(snapshot(staged.root)).toEqual(normalized(snapshot(root)));
    staged.cleanup();
    expect(readdirSync(stagingDir)).toEqual([]);
  });
});
