import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type RuntimeReleaseErrorCode,
  serializeRuntimeManifest,
  stageRuntimeArtifact,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { tempDir } from "../../../store/helpers.js";
import { envelopeOf, failure, gz, put, type Rec, runtimeTree, writeManifest } from "./fixture.js";

/*
 * Row 002-30 (wave-4-contract.md): every malformed or hostile envelope is
 * refused in memory, before the staging directory exists. Each case edits
 * a valid envelope of the fixture tree in one way.
 */

const V = "0.1.900";
type Envelope = { schema: unknown; version: unknown; files: Rec[]; [key: string]: unknown };

function envelope(root = runtimeTree(V)): Envelope {
  return envelopeOf(root, V);
}

type Entries = Record<string, { sha256: string; mode: number }>;
type Editable = { schema: 1; version: string; nodeFloor: string; files: Entries };

/** Rewrites the envelope's `runtime.json` record after `edit`, keeping it canonical. */
function editManifest(env: Envelope, edit: (manifest: Editable) => void): void {
  const record = env.files.find((file) => file.path === "runtime.json");
  if (record === undefined) throw new Error("fixture lacks runtime.json");
  const manifest: Editable = JSON.parse(Buffer.from(record.data, "base64").toString("utf8"));
  edit(manifest);
  record.data = Buffer.from(serializeRuntimeManifest(manifest)).toString("base64");
}

const without = (env: Envelope, path: string): void => {
  env.files = env.files.filter((file) => file.path !== path);
};

/** Adds `record` keeping the paths sorted. */
const withRecord = (env: Envelope, record: Rec): void => {
  env.files = [...env.files, record].sort((a, b) => (a.path < b.path ? -1 : 1));
};

const b64 = (text: string): string => Buffer.from(text).toString("base64");

/** Stages `env` and expects `code` with `text` in the message, and no staging directory. */
function refused(
  env: unknown,
  code: RuntimeReleaseErrorCode,
  text: string,
  options: { expectedVersion?: string; nodeVersion?: string } = {},
): void {
  const stagingDir = join(tempDir(), "staging");
  const error = failure(() => stageRuntimeArtifact({ artifact: gz(env), stagingDir, ...options }));
  expect({ code: error.code, message: error.message }).toEqual({
    code,
    message: expect.stringContaining(text),
  });
  expect(existsSync(stagingDir)).toBe(false);
}

describe("stageRuntimeArtifact refuses before staging", () => {
  it.each([
    ["../escape.mjs"],
    ["/etc/passwd"],
    ["dist\\evil.mjs"],
    ["dist/./runtime2.mjs"],
    ["dist//runtime2.mjs"],
    ["dist/"],
    [""],
    ["dist/a\nb.mjs"],
    ["dіst/runtime.mjs"],
    ["dist/with space.mjs"],
  ])("an unsafe record path %j", (path) => {
    const env = envelope();
    withRecord(env, { path, mode: 0o644, data: b64("x") });
    refused(env, "runtime", "unsafe runtime path");
  });

  it.each([
    ["a symlink", { type: "symlink", target: "/etc/passwd" }],
    ["a hard link", { linkpath: "dist/runtime.mjs" }],
    ["a directory", { type: "directory" }],
  ])("%s record", (_name, extra) => {
    const env = envelope();
    withRecord(env, { path: "dist/zz.mjs", mode: 0o644, data: "", ...extra });
    refused(env, "artifact", "regular files only");
  });

  it.each([[0o777], [0o4755], [0o600], ["0644"]])("mode %s", (mode) => {
    const env = envelope();
    const record = env.files.find((file) => file.path === "dist/stop.mjs");
    if (record === undefined) throw new Error("fixture lacks dist/stop.mjs");
    record.mode = mode as number;
    refused(env, "runtime", "mode");
  });

  it("a duplicate path", () => {
    const env = envelope();
    const record = env.files.find((file) => file.path === "dist/stop.mjs");
    if (record === undefined) throw new Error("fixture lacks dist/stop.mjs");
    withRecord(env, { ...record });
    refused(env, "artifact", "unique and sorted");
  });

  it("unsorted records", () => {
    const env = envelope();
    env.files.reverse();
    refused(env, "artifact", "unique and sorted");
  });

  it("paths equal but for case, and a file under a file", () => {
    const upper = envelope();
    withRecord(upper, { path: "skills/squeal/skill.md", mode: 0o644, data: b64("x") });
    refused(upper, "runtime", "duplicate runtime path");
    const nested = envelope();
    withRecord(nested, { path: "dist/stop.mjs/inner", mode: 0o644, data: b64("x") });
    refused(nested, "runtime", "lies under file");
  });

  it("a file the manifest does not list, and a listed file that is absent", () => {
    const extra = envelope();
    withRecord(extra, { path: "dist/extra.mjs", mode: 0o644, data: b64("x") });
    refused(extra, "runtime", "dist/extra.mjs is not in runtime.json");
    const absent = envelope();
    without(absent, "dist/code/grammar.wasm");
    refused(absent, "runtime", "lacks listed file dist/code/grammar.wasm");
  });

  it("a required entry missing from both manifest and records", () => {
    const env = envelope();
    without(env, "dist/runtime.mjs");
    editManifest(env, (manifest) => {
      delete manifest.files["dist/runtime.mjs"];
    });
    refused(env, "runtime", "lacks dist/runtime.mjs");
  });

  it("a launcher that is not executable", () => {
    const env = envelope();
    const record = env.files.find((file) => file.path === "bin/squeal-launcher");
    if (record === undefined) throw new Error("fixture lacks the launcher");
    record.mode = 0o644;
    editManifest(env, (manifest) => {
      const launcher = manifest.files["bin/squeal-launcher"];
      if (launcher !== undefined) launcher.mode = 0o644;
    });
    refused(env, "runtime", "bin/squeal-launcher must have mode 0755");
  });

  it("no runtime.json", () => {
    const env = envelope();
    without(env, "runtime.json");
    refused(env, "runtime", "no 0644 runtime.json");
  });

  it("an unsupported envelope schema, an extra key and a malformed version", () => {
    refused({ ...envelope(), schema: 2 }, "artifact", "unsupported schema 2");
    refused({ ...envelope(), signature: "x" }, "artifact", "exactly schema, version and files");
    refused({ ...envelope(), version: "../0.1.900" }, "artifact", "invalid version");
  });

  it("versions that disagree: envelope, runtime.json, plugin manifest, descriptor", () => {
    refused(
      { ...envelope(), version: "0.1.901" },
      "runtime",
      "names 0.1.900, the artifact 0.1.901",
    );
    refused(envelope(), "runtime", "expected 0.1.999", { expectedVersion: "0.1.999" });
    const root = runtimeTree(V);
    put(
      root,
      ".codex-plugin/plugin.json",
      `${JSON.stringify({ name: "squeal", version: "0.1.1" })}\n`,
    );
    writeManifest(root, V);
    refused(envelope(root), "runtime", "must name squeal at version 0.1.900");
  });

  it("a Node floor the running Node is below, and a malformed floor", () => {
    refused(envelope(), "node", "needs Node 22.19.0 or newer", { nodeVersion: "22.18.9" });
    const env = envelope();
    editManifest(env, (manifest) => {
      manifest.nodeFloor = ">=22";
    });
    refused(env, "runtime", "unsupported Node floor");
  });

  it("non-canonical base64", () => {
    const env = envelope();
    const record = env.files.find((file) => file.path === "dist/stop.mjs");
    if (record === undefined) throw new Error("fixture lacks dist/stop.mjs");
    record.data = `${record.data.replace(/=+$/, "")}*`;
    refused(env, "artifact", "not canonical base64");
  });
});
