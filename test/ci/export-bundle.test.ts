import { describe, expect, it, vi } from "vitest";
import { bundleOf, type KeyedFile } from "../../src/core/ci/export-bundle.js";
import { observedModulesMetaKey } from "../../src/core/keys/modules.js";
import { observedDirectMetaKey, observedMetaKey } from "../../src/core/keys/observed.js";
import { observedStartupMetaKey } from "../../src/core/keys/startup.js";
import type { ExportHeader } from "../../src/core/store/imports.js";
import { encodeBundle } from "../../src/core/store/transfer-bundle.js";
import type { ProjectName, WorktreeId } from "../../src/core/types/common.js";
import { fakeCommonDir, open } from "../store/helpers.js";

/*
 * Row 018-71: `squeal ci export` read and parsed a project's observed maps
 * once per exported file (37 s of 83 s on squawk's 1948 files). The bundle
 * now reads each `meta` key once. Its bytes are what the per-file read gave:
 * each file has its own entry of each map, none of another file's, and a
 * file named as an `Object.prototype` member has only what it holds (row
 * 018-59).
 */

const HEADER: ExportHeader = {
  squealVersion: "0.0.0-test",
  keyFormat: 1,
  commit: "c".repeat(40),
  dirty: false,
  createdAt: 1_762_000_000_000,
  source: { kind: "local" },
};

const MAPS = {
  observed: observedMetaKey,
  observedDirect: observedDirectMetaKey,
  observedModules: observedModulesMetaKey,
};

function keyed(project: ProjectName, path: string): KeyedFile {
  return {
    file: {
      project,
      path,
      key: `k-${project}-${path}`,
      closure: { paths: [path], complete: true, method: "test" },
    },
    records: [],
  };
}

describe("ci export's bundle reads the observed maps once (row 018-71)", () => {
  it("gives each file its own entries, as a read per file gave them, reading each key once", () => {
    const store = open(fakeCommonDir());
    const entries: Record<ProjectName, Record<keyof typeof MAPS, Record<string, string[]>>> = {
      server: {
        observed: { "a.test.ts": ["src/a.ts"], "b.test.ts": ["src/b.ts", "src/c.ts"] },
        observedDirect: { "b.test.ts": ["src/b.ts"] },
        observedModules: { "a.test.ts": ["node_modules/x/index.js"] },
      },
      web: {
        // A literal `__proto__:` sets the prototype; JSON text holds it as an own entry.
        observed: JSON.parse('{"__proto__":["src/proto.ts"],"w.test.ts":["src/w.ts"]}'),
        observedDirect: {},
        observedModules: { "w.test.ts": ["node_modules/y/index.js"] },
      },
    };
    for (const [project, maps] of Object.entries(entries)) {
      for (const [map, key] of Object.entries(MAPS)) {
        store.meta.set(key(project), JSON.stringify(maps[map as keyof typeof MAPS]));
      }
    }
    store.meta.set(observedStartupMetaKey("server"), JSON.stringify(["setup.ts"]));
    const read = vi.spyOn(store.meta, "get");

    const files = [
      keyed("web", "w.test.ts"),
      keyed("server", "b.test.ts"),
      keyed("web", "constructor"),
      keyed("server", "a.test.ts"),
      keyed("web", "__proto__"),
      keyed("server", "none.test.ts"),
    ];
    const { bundle, absolute } = bundleOf(store, "wt" as WorktreeId, HEADER, files);

    expect(absolute).toEqual([]);
    const observed = bundle.testFiles.map((f) => [f.project, f.path, f.observed]);
    expect(observed).toEqual([
      [
        "server",
        "a.test.ts",
        { observed: ["src/a.ts"], observedModules: ["node_modules/x/index.js"] },
      ],
      ["server", "b.test.ts", { observed: ["src/b.ts", "src/c.ts"], observedDirect: ["src/b.ts"] }],
      ["server", "none.test.ts", {}],
      ["web", "__proto__", { observed: ["src/proto.ts"] }],
      ["web", "constructor", {}],
      [
        "web",
        "w.test.ts",
        { observed: ["src/w.ts"], observedModules: ["node_modules/y/index.js"] },
      ],
    ]);
    expect(bundle.observedStartup).toEqual([{ project: "server", paths: ["setup.ts"] }]);
    const keys = read.mock.calls.map(([key]) => key);
    const maps = Object.values(MAPS).flatMap((key) => [key("server"), key("web")]);
    for (const key of maps) expect(keys.filter((k) => k === key)).toHaveLength(1);

    // The bytes equal a bundle of the same files whose maps were read for each file alone.
    const fileByFile = files.map((f) => bundleOf(store, "wt" as WorktreeId, HEADER, [f]));
    const joined = {
      ...bundle,
      testFiles: fileByFile
        .flatMap((b) => b.bundle.testFiles)
        .sort((a, b) => a.project.localeCompare(b.project) || (a.path < b.path ? -1 : 1)),
    };
    expect(encodeBundle(joined).equals(encodeBundle(bundle))).toBe(true);
  });
});
