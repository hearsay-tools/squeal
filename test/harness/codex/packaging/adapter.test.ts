import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hookHashes, PLUGIN_KEY_SOURCE } from "../../../../src/cli/codex/hash.js";
import { readPluginHooks } from "../../../../src/cli/codex/launcher.js";
import { LAUNCHER_COPY, LAUNCHER_SOURCE, REPO_ROOT } from "../../../../src/harness/build.js";
import { ADAPTER_HOOKS } from "../../../../src/harness/codex/adapter/index.js";
import { publishRuntime } from "../../../../src/harness/codex/adapter/store.js";
import { CODEX_DESCRIPTION, CODEX_PLUGIN_DIR } from "../../../../src/harness/codex/build.js";
import {
  buildCodexAdapter,
  CODEX_ADAPTER_VERSION,
  declaredHooks,
} from "../../../../src/harness/codex/build-adapter.js";
import { runNode } from "../../bundle-helpers.js";
import { type Ran, runtimeTree, write } from "../adapter/fixture.js";
import { A, adapterAt, B, scratch, snapshotTree } from "./fixture.js";

/*
 * Row 002-31 (spec 002 D7): the explicit adapter build. The fixed plugin
 * keeps its ten committed declarations, carries one adapter bundle per hook,
 * a whole seed and a frozen launcher, names its own version, and is the same
 * bytes every time. Its bundles run the session's runtime: the seed at first contact,
 * the current runtime for a new session once one is published.
 */

const SLOW = { timeout: 120_000 } as const;

let tmp: ReturnType<typeof scratch>;
let seedA = "";
let plugin = "";
let snapshot: Record<string, string> = {};
let inputs: string[] = [];
beforeAll(async () => {
  tmp = scratch("sq-adapter-build-");
  seedA = runtimeTree(join(tmp.dir, "seed-a"), A);
  plugin = join(tmp.dir, "plugin");
  inputs = Object.keys((await adapterAt(plugin, seedA)).metafile.inputs);
  snapshot = snapshotTree(plugin);
}, 120_000);
afterAll(() => tmp.cleanup());

describe("the fixed plugin's build", () => {
  it(
    "is reproducible: a second build from the same seed is the same bytes and modes",
    SLOW,
    async () => {
      const again = join(tmp.dir, "again");
      await adapterAt(again, seedA);
      expect(snapshotTree(again)).toEqual(snapshot);
    },
  );

  it("holds its manifest, declarations, bridges, one bundle per hook and the seed, nothing else", () => {
    expect(readdirSync(plugin).sort()).toEqual([
      ".codex-plugin",
      ".gitignore",
      "README.md",
      "bin",
      "dist",
      "hooks",
      "seed",
      "skills",
    ]);
    expect(readdirSync(join(plugin, "dist")).sort()).toEqual(
      ADAPTER_HOOKS.map((hook) => `${hook}.mjs`).sort(),
    );
    for (const path of ["hooks/hooks.json", "skills/squeal/SKILL.md", "skills/setup/SKILL.md"]) {
      expect(readFileSync(join(plugin, path), "utf8"), path).toBe(
        readFileSync(join(CODEX_PLUGIN_DIR, path), "utf8"),
      );
    }
    expect(snapshotTree(join(plugin, "seed"))).toEqual(snapshotTree(seedA));
  });

  it("carries the launcher's source as a frozen 0755 root copy for released updaters", () => {
    const launcher = join(plugin, LAUNCHER_COPY.to);
    expect(readdirSync(join(plugin, "bin"))).toEqual(["squeal-launcher"]);
    expect(readFileSync(launcher, "utf8")).toBe(
      readFileSync(join(REPO_ROOT, LAUNCHER_SOURCE), "utf8"),
    );
    expect(statSync(launcher).mode & 0o777).toBe(0o755);
  });

  it("bundles only the adapter's own modules into each hook entry (002-29 boundary)", () => {
    const files = inputs.filter((input) => !input.startsWith("squeal-adapter-hook:"));
    expect(files.length).toBeGreaterThan(0);
    expect(files.filter((input) => !input.startsWith("src/harness/codex/adapter/"))).toEqual([]);
    for (const hook of ADAPTER_HOOKS) {
      const text = readFileSync(join(plugin, "dist", `${hook}.mjs`), "utf8");
      expect(text, hook).toContain(`await runAdapterHook(${JSON.stringify(hook)});`);
      expect(text, hook).not.toMatch(/from "(?!node:)/);
    }
  });

  it("names the adapter's own version, not the seed's", () => {
    expect(CODEX_ADAPTER_VERSION).toBe("1.0.1");
    expect(JSON.parse(readFileSync(join(plugin, ".codex-plugin/plugin.json"), "utf8"))).toEqual({
      name: "squeal",
      version: CODEX_ADAPTER_VERSION,
      description: CODEX_DESCRIPTION,
    });
  });

  it("keeps exactly ten handlers at their positions, with the committed trust hashes", () => {
    const names = declaredHooks(plugin);
    expect(names).toHaveLength(10);
    expect([...names].sort()).toEqual([...ADAPTER_HOOKS].sort());
    const hashes = (root: string) => hookHashes(readPluginHooks(root), PLUGIN_KEY_SOURCE);
    expect(hashes(plugin)).toEqual(hashes(CODEX_PLUGIN_DIR));
    expect(hashes(plugin)).toHaveLength(10);
  });

  it("refuses declarations that run another hook set, an incomplete seed, or a foreign directory", async () => {
    const bad = join(tmp.dir, "bad");
    write(join(bad, "hooks", "hooks.json"), JSON.stringify({ hooks: { Stop: [] } }));
    await expect(
      buildCodexAdapter({ pluginDir: join(tmp.dir, "out-1"), seed: seedA, from: bad }),
    ).rejects.toThrow(/not the adapter's/);
    await expect(
      buildCodexAdapter({ pluginDir: join(tmp.dir, "out-2"), seed: bad, from: CODEX_PLUGIN_DIR }),
    ).rejects.toThrow(/runtime\.json/);
    const foreign = join(tmp.dir, "foreign");
    write(join(foreign, "package.json"), "{}\n");
    await expect(
      buildCodexAdapter({ pluginDir: foreign, seed: seedA, from: CODEX_PLUGIN_DIR }),
    ).rejects.toThrow(/holds package\.json/);
  });
});

describe("the built adapter bundles", () => {
  /** A data directory and a repository that uses Squeal, for one machine. */
  function machine(name: string) {
    const data = join(tmp.dir, name, "data");
    const repo = join(tmp.dir, name, "repo");
    write(join(repo, "squeal.config.json"), "{}\n");
    const hook = async (hookName: string, session: string): Promise<Ran> => {
      const out = await runNode(
        ["--disable-warning=ExperimentalWarning", join(plugin, "dist", `${hookName}.mjs`)],
        JSON.stringify({ session_id: session, cwd: repo }),
        { PLUGIN_ROOT: plugin, PLUGIN_DATA: data },
      );
      expect(out, `${hookName} ${session}`).toMatchObject({ code: 0, stderr: "" });
      return JSON.parse(out.stdout) as Ran;
    };
    return { data, hook };
  }

  it(
    "run each hook through the seed at first contact, then the current runtime for a new session",
    SLOW,
    async () => {
      const m = machine("m1");
      // SessionEnd releases the session's pin: it runs last.
      for (const name of ADAPTER_HOOKS.filter((hook) => hook !== "session-end")) {
        const ran = await m.hook(name, "s1");
        expect(ran, name).toMatchObject({ name, version: A, adapter: plugin, data: m.data });
        expect(ran.root, name).toBe(join(m.data, "versions", A));
      }
      const runtimeB = runtimeTree(join(tmp.dir, "runtime-b"), B);
      publishRuntime({ sourceRoot: runtimeB, data: m.data, select: true });
      expect((await m.hook("session-start", "s2")).version).toBe(B);
      // The first session stays on the runtime it pinned, to its end.
      expect((await m.hook("stop", "s1")).version).toBe(A);
      expect((await m.hook("session-end", "s1")).version).toBe(A);
    },
  );
});
