import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Vitest } from "vitest/node";
import { exposeGc } from "../../../src/core/daemon/idle-gc.js";
import { withSlowInstance } from "../../../src/core/daemon/slow-instance.js";
import { type InvalidatedPath, SLOW_LANE_PREFIX } from "../../../src/core/types/index.js";
import { VitestAdapter } from "../../../src/runners/vitest/adapter.js";
import {
  closedTargets,
  closeEmptied,
  emptyClosed,
} from "../../../src/runners/vitest/empty-closed.js";
import { loadVitest, type VitestNode } from "../../../src/runners/vitest/load.js";
import { WorktreePaths } from "../../../src/runners/vitest/paths.js";
import { RunCollector } from "../../../src/runners/vitest/reporter.js";
import { abandon } from "../../../src/runners/vitest/run.js";
import { openFixture, outcomes, ref, SLOW } from "./helpers.js";

/*
 * Task 013-06 (research `vitest-close-leak.md` 3a): Vite 8 keeps every
 * closed instance reachable, so Squeal empties each one whose close it
 * awaited. The closed `Vitest` stays reachable as an empty shell, through
 * the plugin objects the emptying leaves alone; what it held is collected.
 */

/**
 * An instance the adapter created, held weakly, with its core project, its
 * projects, its Vite servers and their environments in `parts`, and each
 * environment's module graph, all taken before its close.
 */
interface Created {
  readonly vitest: WeakRef<Vitest>;
  readonly parts: readonly WeakRef<object>[];
  readonly graphs: readonly WeakRef<object>[];
}

const kept = (ref: WeakRef<object>) => Reflect.ownKeys(ref.deref() ?? {}).length > 0;

/** `whole`: it keeps its own properties; `freed`: it and its parts emptied, and every graph collected. */
function state(created: Created): "whole" | "parts whole" | "freed" | "graphs alive" {
  if (kept(created.vitest)) return "whole";
  if (created.parts.some(kept)) return "parts whole";
  return created.graphs.every((graph) => graph.deref() === undefined) ? "freed" : "graphs alive";
}

/** `vitest/node` of `root`, recording in `created` each instance it creates. */
async function tracked(root: string, created: Created[]): Promise<VitestNode> {
  const real = await loadVitest(root);
  return {
    ...real,
    createVitest: async (...args: Parameters<VitestNode["createVitest"]>) => {
      const vitest = await real.createVitest(...args);
      const projects = new Set([vitest.getRootProject(), ...vitest.projects]);
      const servers = new Set([vitest.vite, ...[...projects].map((p) => p.vite)]);
      const environments = [...servers].flatMap((server) => Object.values(server.environments));
      const parts = [...projects, ...servers, ...environments].map((part) => new WeakRef(part));
      const graphs = environments.map((env) => new WeakRef<object>(env.moduleGraph));
      created.push({ vitest: new WeakRef(vitest), parts, graphs });
      return vitest;
    },
  } as VitestNode;
}

async function opened(root: string, created: Created[]) {
  const real = realpathSync(root);
  const node = await tracked(real, created);
  const adapter = new VitestAdapter(new WorktreePaths(real), node);
  await adapter.open();
  return adapter;
}

const gc = exposeGc();

/** Full GCs in separate macrotasks, so no job keeps a `WeakRef` target alive. */
async function collect(): Promise<void> {
  expect(gc).not.toBeNull();
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    gc?.({ type: "major", execution: "sync", flavor: "last-resort" });
  }
}

const changed = (path: string): InvalidatedPath[] => [{ path, kind: "change" }];

async function until(done: () => boolean): Promise<void> {
  while (!done()) await new Promise((resolve) => setTimeout(resolve, 20));
}

/** A global setup that says it started, waits for `go` (10 s at most), then throws. */
const rejecting = (started: string, go: string) => ({
  "vitest.config.ts":
    'export default { test: { include: ["test/math.test.ts"], globalSetup: ["./boot.ts"] } };\n',
  "boot.ts": [
    'import { existsSync, writeFileSync } from "node:fs";',
    "export default async function setup() {",
    `  writeFileSync(${JSON.stringify(started)}, "");`,
    `  for (let i = 0; i < 500 && !existsSync(${JSON.stringify(go)}); i++) {`,
    "    await new Promise((resolve) => setTimeout(resolve, 20));",
    "  }",
    '  throw new Error("bootstrap");',
    "}",
    "",
  ].join("\n"),
});
const MATH = [ref("test/math.test.ts")];

/** A root config that selects only a separate project config: no project is the core one. */
const SEPARATE = {
  "vitest.config.ts": 'export default { test: { projects: ["unit/vitest.config.ts"] } };\n',
  "unit/vitest.config.ts":
    'export default { test: { name: "unit", root: "..", include: ["test/math.test.ts"] } };\n',
};
const UNIT_MATH = [ref("test/math.test.ts", "unit")];

/** `freed` for each closed instance, and `whole` for the one in use, if any. */
const freed = (created: readonly Created[], inUse: boolean) =>
  created.map((_, i) => (inUse && i === created.length - 1 ? "whole" : "freed"));

describe("a closed Vitest instance is freed (task 013-06)", SLOW, () => {
  it("frees each instance a recreate closes, and keeps the one in use", async () => {
    const created: Created[] = [];
    const fx = await openFixture("basic", {}, (root) => opened(root, created));
    for (let i = 0; i < 3; i++) {
      expect(outcomes(await fx.adapter.run(MATH, fx.runOptions()))).toEqual(["pass", "pass"]);
      expect((await fx.adapter.invalidate(changed("vitest.config.ts"))).recreatedProjects).toEqual([
        "",
      ]);
    }
    expect(created.every((c) => c.graphs.length > 0)).toBe(true);
    await collect();
    expect(created.map(state)).toEqual(["freed", "freed", "freed", "whole"]);
  });

  // Review of 0.1.250: the close clears `vitest.vite` when no project is the core one.
  it("frees the root server and core project a recreate closes, with a separate project config", async () => {
    const created: Created[] = [];
    const fx = await openFixture("basic", SEPARATE, (root) => opened(root, created));
    for (let i = 0; i < 2; i++) {
      expect(outcomes(await fx.adapter.run(UNIT_MATH, fx.runOptions()))).toEqual(["pass", "pass"]);
      expect((await fx.adapter.invalidate(changed("vitest.config.ts"))).recreatedProjects).toEqual([
        "unit",
      ]);
    }
    // The core project, two servers and their environments; a config written just now may add a recreate.
    expect(created.length).toBeGreaterThanOrEqual(3);
    expect(created.every((c) => c.parts.length > 4 && c.graphs.length > 0)).toBe(true);
    await collect();
    expect(created.map(state)).toEqual(freed(created, true));
  });

  it.each([
    ["the root project", {}, MATH],
    ["a separate project config", SEPARATE, UNIT_MATH],
  ])(
    "frees each slow instance a drained pass closes, with %s (spec 004 D2)",
    async (_, files, refs) => {
      const created: Created[] = [];
      const fx = await openFixture("basic", files);
      const root = realpathSync(fx.root);
      const node = await tracked(root, created);
      const runner = withSlowInstance(
        fx.adapter,
        () => new VitestAdapter(new WorktreePaths(root), node),
      );
      const lane = `${SLOW_LANE_PREFIX}vitest`;
      for (let i = 0; i < 3; i++) {
        const report = await runner.run(refs, fx.runOptions({ lane }));
        expect(outcomes(report)).toEqual(["pass", "pass"]);
        await runner.releaseLane?.(lane);
      }
      expect(created.length).toBeGreaterThanOrEqual(3);
      await collect();
      expect(created.map(state)).toEqual(freed(created, false));
    },
  );

  it("frees the instance of a run whose global setup rejects, once the run read its graphs", async () => {
    const created: Created[] = [];
    const signals = mkdtempSync(join(tmpdir(), "squeal-empty-closed-"));
    const started = join(signals, "started");
    const go = join(signals, "go");
    try {
      const fx = await openFixture("basic", rejecting(started, go), (root) =>
        opened(root, created),
      );
      // The instance reads src/math.ts, so the run sorts a touch of it through its graphs (013-02).
      await fx.adapter.closure(ref("test/math.test.ts"));
      const running = fx.adapter.run(MATH, fx.runOptions());
      await until(() => existsSync(started));
      await fx.adapter.invalidate([{ path: "src/math.ts", kind: "touch" }]);
      writeFileSync(go, "");
      const report = await running;
      expect(report.startupFailure?.setupFile).toBe("boot.ts");
      expect(report.startupFailure?.error.message).toBe("bootstrap");
      await collect();
      expect(created.map(state)).toEqual(["freed"]);
    } finally {
      rmSync(signals, { recursive: true, force: true });
    }
  });

  it("keeps a plugin object the config imports from a package, which the next instance shares", async () => {
    const imports = Symbol.for("squeal.test.sharedPluginImports");
    const counter = globalThis as { [imports]?: number };
    delete counter[imports];
    const fx = await openFixture("basic", SHARED_PLUGIN);
    const shared = [ref("test/shared.test.ts")];
    expect(outcomes(await fx.adapter.run(shared, fx.runOptions()))).toEqual(["pass"]);
    expect((await fx.adapter.invalidate(changed("vitest.config.ts"))).recreatedProjects).toEqual([
      "",
    ]);
    expect(outcomes(await fx.adapter.run(shared, fx.runOptions()))).toEqual(["pass"]);
    // Imported once: the closed instance and the one after it hold the same plugin object.
    expect(counter[imports]).toBe(1);
  });
});

/** A package whose plugin is an object, not a factory, and a config and test that use it. */
const SHARED_PLUGIN = {
  "node_modules/shared-plugin/package.json":
    '{ "name": "shared-plugin", "type": "module", "exports": "./index.js" }\n',
  "node_modules/shared-plugin/index.js": [
    'const imports = Symbol.for("squeal.test.sharedPluginImports");',
    "globalThis[imports] = (globalThis[imports] ?? 0) + 1;",
    "export const shared = {",
    '  name: "shared",',
    '  resolveId: (id) => (id === "virtual:shared" ? "\\0virtual:shared" : undefined),',
    '  load: (id) => (id === "\\0virtual:shared" ? "export const shared = \\"shared\\";" : undefined),',
    "};",
    "",
  ].join("\n"),
  "vitest.config.ts": [
    'import { shared } from "shared-plugin";',
    'export default { plugins: [shared], test: { include: ["test/**/*.test.ts"] } };',
    "",
  ].join("\n"),
  "test/shared.test.ts": [
    'import { expect, test } from "vitest";',
    'import { shared } from "virtual:shared";',
    'test("reads the module of the shared plugin", () => expect(shared).toBe("shared"));',
    "",
  ].join("\n"),
};

describe("emptyClosed and closeEmptied (task 013-06)", () => {
  it("empties the instance, its logger, projects, servers and environments, and no plugin", () => {
    const plugin = { name: "shared", transform: () => undefined };
    const environment = { name: "ssr", moduleGraph: {}, plugins: [plugin] };
    const server = { config: { plugins: [plugin] }, environments: { ssr: environment } };
    const client = { name: "client", moduleGraph: {} };
    const projectServer = { environments: { client } };
    const project = { name: "a", vite: projectServer };
    const root = { name: "", vite: server };
    const logger = { console: {} };
    const vitest = {
      vite: server,
      projects: [root, project],
      logger,
      state: {},
      getRootProject: () => root,
    };
    expect(emptyClosed(closedTargets(vitest as unknown as Vitest))).toBe(8);
    for (const emptied of [
      vitest,
      logger,
      root,
      project,
      server,
      projectServer,
      environment,
      client,
    ]) {
      expect(Reflect.ownKeys(emptied)).toEqual([]);
    }
    expect(Object.keys(plugin)).toEqual(["name", "transform"]);
  });

  // Review of 0.1.250: Vitest 5.0.3 clears `vite` when it closes a core project no other project is.
  it("closeEmptied empties the root server and core project the close cleared from the instance", async () => {
    const environment = { name: "ssr", moduleGraph: {} };
    const server = { environments: { ssr: environment } };
    const core = { name: "", vite: server };
    const projectServer = { environments: {} };
    const project = { name: "unit", vite: projectServer };
    const vitest: Record<string, unknown> = {
      vite: server,
      projects: [project],
      getRootProject: () => core,
      close: async () => {
        vitest.vite = undefined;
      },
    };
    await closeEmptied(vitest as unknown as Vitest);
    for (const emptied of [vitest, core, server, environment, project, projectServer]) {
      expect(Reflect.ownKeys(emptied)).toEqual([]);
    }
  });

  it("closeEmptied drops an error while gathering or emptying, and leaves every target whole when the close fails", async () => {
    const odd = {
      close: async () => {},
      get projects(): never {
        throw new Error("a shape it does not know");
      },
    };
    await expect(closeEmptied(odd as unknown as Vitest)).resolves.toBeUndefined();
    const sealed = new Proxy(
      { name: "" },
      {
        deleteProperty: () => {
          throw new Error("a target it cannot empty");
        },
      },
    );
    const emptying = { projects: [], getRootProject: () => sealed, close: async () => {} };
    await expect(closeEmptied(emptying as unknown as Vitest)).resolves.toBeUndefined();
    expect(Object.keys(sealed)).toEqual(["name"]);
    const server = { environments: { ssr: { name: "ssr" } } };
    const core = { name: "", vite: server };
    const failing = {
      vite: server,
      projects: [core],
      getRootProject: () => core,
      close: () => Promise.reject(new Error("the close failed")),
    };
    await expect(closeEmptied(failing as unknown as Vitest)).rejects.toThrow("the close failed");
    expect(Object.keys(failing)).toEqual(["vite", "projects", "getRootProject", "close"]);
    expect(Object.keys(core)).toEqual(["name", "vite"]);
    expect(Object.keys(server.environments.ssr)).toEqual(["name"]);
  });

  it("is never called by abandon, whose close may hang and reads the instance", async () => {
    let closed = () => {};
    const vitest = { state: {}, close: () => new Promise<void>((resolve) => (closed = resolve)) };
    abandon(vitest as unknown as Vitest, new RunCollector([], new WorktreePaths("/work/tree")));
    closed();
    await new Promise((resolve) => setImmediate(resolve));
    expect(Object.keys(vitest)).toEqual(["state", "close"]);
  });
});
