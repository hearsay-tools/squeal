import { mkdirSync, readFileSync, rmSync, symlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  dependencyKeys,
  type InstalledDependencies,
  installedDependencies,
  PackageScans,
} from "../../src/core/keys/index.js";
import type { RunnerPackages } from "../../src/core/types/index.js";
import { tempDir, writeFile } from "../hash/git-repo.js";
import { type PnpmFixture, writePnpmInstall } from "./install.js";

// Task 011-162 R2 (011 C3, C11; design sections 3 and 4): pnpm's installed `lock.yaml` stands for
// the install under npm's rule on pnpm's layout, orphan folders ignored, and then gives per-package
// keys; only the default layout (`isolated`, `.pnpm`, lockfile 9) gets the graph.

const INSTALL: PnpmFixture = {
  importers: {
    ".": { vitest: "4.0.0" },
    "packages/app": { a: "1.0.0", c: "1.0.0", lib: "link:../lib", pub: "1.0.0" },
  },
  snapshots: {
    "a@1.0.0": { dependencies: { b: "1.0.0" } },
    "b@1.0.0": {},
    "c@1.0.0": {},
    "pub@1.0.0": { files: { "index.js": 'require("node:child_process");\n' } },
    "vitest@4.0.0": {},
  },
};

/** `INSTALL` with `a`'s dependency `b` at 2.0.0. */
const BUMPED: PnpmFixture = {
  ...INSTALL,
  snapshots: { ...INSTALL.snapshots, "a@1.0.0": { dependencies: { b: "2.0.0" } }, "b@2.0.0": {} },
};

const ENVIRONMENT: RunnerPackages = {
  imports: [{ from: "", name: "vitest" }],
  builtins: [],
  runner: [{ from: "", name: "vitest" }],
};

const uses = (name: string, ...builtins: string[]): RunnerPackages => ({
  imports: [{ from: "packages/app/test", name }],
  builtins,
});

const LOCK = "node_modules/.pnpm/lock.yaml";
const AFTER_INSTALL = new Date("2026-09-20T00:00:00Z");

describe("pnpm's lock.yaml trusted and read for per-package keys (011-162, R2)", () => {
  let dir: ReturnType<typeof tempDir>;
  let root: string;
  beforeEach(() => {
    dir = tempDir();
    root = dir.path;
    writeFile(root, "packages/lib/index.js", "export {};\n");
    writePnpmInstall(root, INSTALL);
  });
  afterEach(() => dir.cleanup());

  const read = () => installedDependencies(root, root, new PackageScans());
  const keyOf = (installed: InstalledDependencies, packages: RunnerPackages | undefined) => {
    const keys = dependencyKeys(installed, ENVIRONMENT);
    return `${keys.environment}\0${keys.of(packages)}`;
  };

  it("re-keys only the test file whose packages a bump reaches", async () => {
    const before = await read();
    expect(before.graph).not.toBeNull();
    expect(before.note).toBeNull();
    writePnpmInstall(root, BUMPED);
    const after = await read();
    expect(after.note).toBeNull();
    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(keyOf(after, uses("a"))).not.toBe(keyOf(before, uses("a")));
    expect(keyOf(after, uses("c"))).toBe(keyOf(before, uses("c")));
    expect(keyOf(after, uses("lib"))).toBe(keyOf(before, uses("lib")));
  });

  it("keys each of C11's five fallback cases by the whole fingerprint", async () => {
    const installed = await read();
    const keys = dependencyKeys(installed, ENVIRONMENT);
    const whole = `whole:${installed.fingerprint}`;
    expect(keys.environment).not.toBe(installed.fingerprint);
    expect(keys.of(uses("c"))).not.toBe(whole);
    // (1) a process or a thread; (2) and (3), which the adapter reports as `module`; (4) an
    // opaque package; (5) no packages reported.
    for (const packages of [
      uses("c", "child_process"),
      uses("c", "worker_threads"),
      uses("c", "cluster"),
      uses("c", "module"),
      uses("pub"),
      undefined,
    ]) {
      expect(keys.of(packages)).toBe(whole);
    }
  });

  it("keeps the whole fingerprint, with no note, for a layout or a file it does not read", async () => {
    const trusted = await read();
    const modules = JSON.parse(readFileSync(join(root, "node_modules/.modules.yaml"), "utf8"));
    const layouts = [
      { ...modules, nodeLinker: "hoisted" },
      { ...modules, virtualStoreDir: "../../../store/v11/links" },
      { ...modules, enableGlobalVirtualStore: true },
    ];
    for (const layout of layouts) {
      writeFile(root, "node_modules/.modules.yaml", JSON.stringify(layout));
      const installed = await read();
      expect([installed.graph, installed.note]).toEqual([null, null]);
      expect(installed.fingerprint).toBe(trusted.fingerprint);
      expect(dependencyKeys(installed, ENVIRONMENT).environment).toBe(trusted.fingerprint);
    }
    rmSync(join(root, "node_modules/.modules.yaml"));
    expect((await read()).fingerprint).toBe(trusted.fingerprint);
    writeFile(root, "node_modules/.modules.yaml", JSON.stringify(modules));
    const text = readFileSync(join(root, LOCK), "utf8");
    for (const unread of [text.replace("'9.0'", "'6.0'"), `${text}  "quoted": 1\n`]) {
      writeFile(root, LOCK, unread);
      utimesSync(join(root, LOCK), AFTER_INSTALL, AFTER_INSTALL);
      expect([(await read()).graph, (await read()).note]).toEqual([null, null]);
    }
    rmSync(join(root, LOCK));
    expect((await read()).fingerprint).toBe("none");
  });

  it("is stale with one note for a missing, a newer, an undeclared or a retargeted entry", async () => {
    const trusted = await read();
    const folder = (id: string, name: string) => `node_modules/.pnpm/${id}/node_modules/${name}`;
    const breaks: [string, () => void][] = [
      [
        "missing: node_modules/.pnpm/c@1.0.0/node_modules/c",
        () => rmSync(join(root, "node_modules/.pnpm/c@1.0.0"), { recursive: true }),
      ],
      [
        `newer than it: ${folder("b@1.0.0", "b")}`,
        () => utimesSync(join(root, folder("b@1.0.0", "b")), new Date(), new Date()),
      ],
      [
        "not listed in it: node_modules/extra",
        () => writeFile(root, "node_modules/extra/package.json", "{}"),
      ],
      [
        "newer than it: packages/app/node_modules/c",
        () => {
          rmSync(join(root, "packages/app/node_modules/c"));
          symlinkSync(
            join(root, folder("b@1.0.0", "b")),
            join(root, "packages/app/node_modules/c"),
          );
        },
      ],
    ];
    for (const [reason, breakIt] of breaks) {
      breakIt();
      const stale = await read();
      expect(stale.note).toBe(
        `${LOCK} does not describe the installed packages (${reason}); ` +
          "dependencies are keyed by their package.json files until pnpm rewrites it",
      );
      expect(stale.graph).toBeNull();
      expect(stale.fingerprint).not.toBe(trusted.fingerprint);
      expect(stale.former ?? null).toBeNull();
      dir.cleanup();
      mkdirSync(root);
      writeFile(root, "packages/lib/index.js", "export {};\n");
      writePnpmInstall(root, INSTALL);
    }
  });

  it("fingerprints a stale install's package folders, so a re-versioned folder re-keys", async () => {
    writeFile(root, "node_modules/extra/package.json", "{}");
    const stale = await read();
    writeFile(
      root,
      "node_modules/.pnpm/b@1.0.0/node_modules/b/package.json",
      '{"name":"b","version":"1.0.1"}',
    );
    expect((await read()).fingerprint).not.toBe(stale.fingerprint);
  });

  it("stays trusted with a folder no snapshot names, which pnpm keeps after an update", async () => {
    writePnpmInstall(root, BUMPED);
    const bumped = await read();
    writeFile(root, "node_modules/.pnpm/zzz@0.1.0/node_modules/zzz/package.json", "{}");
    utimesSync(join(root, "node_modules/.pnpm/zzz@0.1.0"), new Date(), new Date());
    const orphaned = await read();
    expect([orphaned.note, orphaned.graph === null]).toEqual([null, false]);
    expect(orphaned.fingerprint).toBe(bumped.fingerprint);
  });
});
