import {
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentFile } from "../../../../src/harness/codex/adapter/layout.js";
import { RuntimeError } from "../../../../src/harness/codex/adapter/manifest.js";
import { publishRuntime, selectRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { tempDir } from "../../../store/helpers.js";
import { runtimeTree, write, writeManifest } from "./fixture.js";

/*
 * Row 002-29 (spec 002 D8, D9; `wave-4-contract.md` "Runtime manifest"):
 * publication validates a whole tree and retains it by one rename, or
 * retains nothing.
 */

const A = "0.1.900";
const B = "0.1.901";
const NODE = "22.19.0";

function setup() {
  const dir = tempDir("sq-adapter-store-");
  return {
    dir,
    data: join(dir, "data"),
    tree: (v: string, name = v) => runtimeTree(join(dir, name), v),
  };
}

/** The `RuntimeError` `run` throws. */
function failure(run: () => unknown): RuntimeError {
  try {
    run();
  } catch (error) {
    if (error instanceof RuntimeError) return error;
    throw error;
  }
  throw new Error("expected a RuntimeError");
}

const versions = (data: string) => readdirSync(join(data, "versions")).sort();

describe("publishRuntime rejects a tree it cannot trust, before anything is retained", () => {
  const cases: [string, (root: string) => void, RegExp][] = [
    [
      "a modified byte",
      (r) => write(join(r, "dist", "stop.mjs"), "// changed\n"),
      /does not match its SHA-256/,
    ],
    [
      "a file outside the inventory",
      (r) => write(join(r, "dist", "extra.mjs"), "x"),
      /not in runtime.json/,
    ],
    [
      "a missing listed file",
      (r) => rmSync(join(r, "dist", "observe", "recorder.cjs")),
      /recorder.cjs is missing/,
    ],
    [
      "a missing required entry",
      (r) => {
        rmSync(join(r, "dist", "runtime.mjs"));
        writeManifest(r, A);
      },
      /dist\/runtime.mjs is missing/,
    ],
    [
      "a plugin manifest of another version",
      (r) => {
        write(
          join(r, ".codex-plugin", "plugin.json"),
          JSON.stringify({ name: "squeal", version: B }),
        );
        writeManifest(r, A);
      },
      /plugin.json names 0.1.901, runtime.json 0.1.900/,
    ],
    [
      "a plugin manifest of another plugin",
      (r) => {
        write(
          join(r, ".codex-plugin", "plugin.json"),
          JSON.stringify({ name: "other", version: A }),
        );
        writeManifest(r, A);
      },
      /does not name squeal/,
    ],
    [
      "a symlink",
      (r) => {
        symlinkSync("stop.mjs", join(r, "dist", "linked.mjs"));
      },
      /linked.mjs is not a regular file/,
    ],
    [
      "a hard-linked file",
      (r) => {
        linkSync(join(r, "dist", "stop.mjs"), join(r, "stop-copy.mjs"));
      },
      /is hard-linked/,
    ],
    [
      "a Node floor this Node does not meet",
      (r) => writeManifest(r, A, "999.0"),
      /needs Node 999.0/,
    ],
  ];
  it.each(cases)("%s", (_, spoil, message) => {
    const { data, tree } = setup();
    const root = tree(A);
    spoil(root);
    expect(() => publishRuntime({ sourceRoot: root, data, select: true, node: NODE })).toThrow(
      message,
    );
    expect(existsSync(join(data, "versions", A))).toBe(false);
    expect(existsSync(currentFile(data))).toBe(false);
    // Nothing staged is left: the private staging directory goes with the failure.
    expect(existsSync(join(data, "versions")) ? versions(data) : []).toEqual([]);
  });

  const manifests: [string, (m: Record<string, unknown>) => void, RegExp][] = [
    ["an unsupported schema", (m) => (m.schema = 2), /no supported schema/],
    ["a version that is no plain release", (m) => (m.version = "../0.1.900"), /no plain version/],
    ["a malformed Node floor", (m) => (m.nodeFloor = ">=22"), /no supported Node floor/],
    ["a traversal path", (m) => (files(m)["../x"] = entry(m)), /unsafe inventory path "..\/x"/],
    ["an absolute path", (m) => (files(m)["/etc/x"] = entry(m)), /unsafe inventory path/],
    ["a backslash path", (m) => (files(m)["dist\\x.mjs"] = entry(m)), /unsafe inventory path/],
    ["a dot segment", (m) => (files(m)["dist/./x.mjs"] = entry(m)), /unsafe inventory path/],
    [
      "runtime.json listing itself",
      (m) => (files(m)["runtime.json"] = entry(m)),
      /unsafe inventory path/,
    ],
    [
      "a mode other than 0644 or 0755",
      (m) => {
        const f = files(m)["dist/stop.mjs"] as { mode: number };
        f.mode = 0o666;
      },
      /mode other than 0644 or 0755/,
    ],
  ];
  const files = (m: Record<string, unknown>) => m.files as Record<string, unknown>;
  const entry = (m: Record<string, unknown>) => files(m)["dist/stop.mjs"];
  it.each(manifests)("a manifest with %s", (_, spoil, message) => {
    const { data, tree } = setup();
    const root = tree(A);
    const manifest = JSON.parse(readFileSync(join(root, "runtime.json"), "utf8")) as Record<
      string,
      unknown
    >;
    spoil(manifest);
    write(join(root, "runtime.json"), JSON.stringify(manifest));
    expect(failure(() => publishRuntime({ sourceRoot: root, data, node: NODE })).message).toMatch(
      message,
    );
    expect(existsSync(data)).toBe(false);
  });
});

describe("publishRuntime retains and selects", () => {
  it("publishes the whole tree with its modes, and selects only when asked", () => {
    const { data, tree } = setup();
    const ref = publishRuntime({ sourceRoot: tree(A), data, node: NODE });
    expect(ref).toEqual({ root: join(data, "versions", A), version: A });
    expect(existsSync(currentFile(data))).toBe(false);
    expect(readFileSync(join(ref.root, "dist", "runtime.mjs"), "utf8")).toContain(A);
    expect(readdirSync(join(ref.root, "bin"))).toEqual(["squeal-launcher"]);
    publishRuntime({ sourceRoot: tree(B), data, select: true, node: NODE });
    expect(JSON.parse(readFileSync(currentFile(data), "utf8"))).toEqual({ schema: 1, version: B });
    expect(versions(data)).toEqual([A, B]);
  });

  it("same-version collision: keeps an existing root of the same payload, rejects another payload", () => {
    const { data, tree } = setup();
    const first = publishRuntime({ sourceRoot: tree(A, "a1"), data, node: NODE });
    const marker = join(first.root, "dist", "runtime.mjs");
    const before = readFileSync(marker, "utf8");
    // The same payload from another staging tree: kept as it is.
    expect(publishRuntime({ sourceRoot: tree(A, "a2"), data, select: true, node: NODE })).toEqual(
      first,
    );
    expect(readFileSync(marker, "utf8")).toBe(before);
    // Another payload claiming A: rejected, the retained root and selection untouched.
    const other = tree(A, "a3");
    write(join(other, "dist", "stop.mjs"), "// other build\n");
    writeManifest(other, A);
    const conflict = failure(() => publishRuntime({ sourceRoot: other, data, node: NODE }));
    expect(conflict.kind).toBe("version-conflict");
    expect(readFileSync(join(first.root, "dist", "stop.mjs"), "utf8")).not.toContain("other build");
    expect(versions(data)).toEqual([A]);
  });

  it("replaces an invalid tree under the version: a copy made before runtime manifests, or a corrupt one", () => {
    const { data, tree } = setup();
    // As spec 005 D3's copy left it: dist, skills and the plugin manifest, no runtime.json.
    write(join(data, "versions", A, "dist", "cli", "squeal.mjs"), "// old copy\n");
    write(
      join(data, "versions", A, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "squeal", version: A }),
    );
    const ref = publishRuntime({ sourceRoot: tree(A), data, node: NODE });
    expect(existsSync(join(ref.root, "runtime.json"))).toBe(true);
    // A retained root whose bytes changed afterwards is invalid too.
    write(join(ref.root, "dist", "stop.mjs"), "// tampered\n");
    publishRuntime({ sourceRoot: tree(A, "again"), data, node: NODE });
    expect(readFileSync(join(ref.root, "dist", "stop.mjs"), "utf8")).toContain(A);
    expect(versions(data)).toEqual([A]);
  });

  it("stages under a private name: a killed publisher's staging is never a version, and a failure stages nothing", () => {
    const { data, tree } = setup();
    // What a publisher killed mid-copy leaves; spec 005 D3's prune removes it (`LEFT`).
    mkdirSync(join(data, "versions", `.${A}.2147483646.tmp`, "dist"), { recursive: true });
    publishRuntime({ sourceRoot: tree(A), data, select: true, node: NODE });
    expect(
      selectRuntime({ pluginRoot: "/nonexistent", data, sessionId: null, node: NODE }),
    ).toEqual({
      root: join(data, "versions", A),
      version: A,
      source: "current",
    });
    const spoiled = tree(B);
    write(join(spoiled, "skills", "squeal", "SKILL.md"), "changed after the manifest\n");
    expect(() => publishRuntime({ sourceRoot: spoiled, data, select: true, node: NODE })).toThrow();
    expect(versions(data)).toEqual([`.${A}.2147483646.tmp`, A]);
    expect(JSON.parse(readFileSync(currentFile(data), "utf8"))).toEqual({ schema: 1, version: A });
  });

  it("an unwritable data directory is reported, and nothing is selected", () => {
    const { dir, tree } = setup();
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "a file\n");
    const error = failure(() =>
      publishRuntime({ sourceRoot: tree(A), data: blocked, select: true, node: NODE }),
    );
    expect(error.kind).toBe("unwritable-data");
    expect(readFileSync(blocked, "utf8")).toBe("a file\n");
  });
});
