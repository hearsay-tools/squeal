import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnableDevEnvironment } from "vite-8.4";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Vitest } from "vitest/node";
import { WorktreePaths } from "../../../src/core/fs/worktree-paths.js";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { type Load, SourceStamps } from "../../../src/runners/vitest/sources.js";
import { SLOW } from "./helpers.js";

/*
 * Row 025-23: Vite 8.4.0 calls `pluginContainer.load(id, { withMetadata: true })`
 * and reads `.code` on the result. `SourceStamps.attach` wraps `load`; a
 * wrapper that dropped the second argument got `null` back for a file no
 * plugin loads, and Vite threw "Cannot read properties of null (reading
 * 'code')", so Vitest could not start. Each case runs a real Vite dev server
 * of one version through the wrapper: 8.4.0 is the `vite-8.4` alias, 8.3.2
 * the repository's `vite`, which Vitest runs on and which calls `load(id)`
 * alone. The repository stays on 8.3 until a release with this fix is
 * installed, since an installed Squeal without it gives no result on 8.4.0.
 */

// Vite 8.4.0's overloaded `load` is a `Load`, and a `Load` takes its second argument.
type Load84 = RunnableDevEnvironment["pluginContainer"]["load"];
expectTypeOf<Load84>().toExtend<Load>();
expectTypeOf<Load>().toBeCallableWith("/src/mod.ts", { withMetadata: true });

interface Server {
  readonly environments: Record<string, unknown>;
  close(): Promise<void>;
}
type CreateServer = (config: Record<string, unknown>) => Promise<Server>;
interface Transforming {
  transformRequest(url: string): Promise<{ readonly code: string } | null>;
}

const VERSIONS: readonly (readonly [
  string,
  () => Promise<{ createServer: unknown; version: string }>,
])[] = [
  ["8.4.0", () => import("vite-8.4")],
  ["8.3.2", () => import("vite")],
];

describe("vitest adapter: the load wrapper on each Vite version (025-23)", SLOW, () => {
  for (const [expected, vite] of VERSIONS) {
    it(`transforms a project file and stamps its read on Vite ${expected}`, async () => {
      const { createServer, version } = await vite();
      expect(version).toBe(expected);
      const root = realpathSync(mkdtempSync(join(tmpdir(), "squeal-025-23-")));
      try {
        mkdirSync(join(root, "src"));
        const file = join(root, "src/mod.ts") as AbsolutePath;
        writeFileSync(file, 'export const which = "old";\n');
        const server = await (createServer as CreateServer)({
          root,
          configFile: false,
          logLevel: "silent",
          appType: "custom",
          server: { middlewareMode: true, ws: false, watch: null },
          optimizeDeps: { noDiscovery: true, include: [] },
        });
        try {
          const vitest = { projects: [{ vite: server }] } as unknown as Vitest;
          const stamps = new SourceStamps(new WorktreePaths(root as AbsolutePath));
          stamps.attach(vitest);
          const ssr = server.environments.ssr as Transforming;
          const result = await ssr.transformRequest("/src/mod.ts");
          expect(result?.code).toContain('"old"');
          expect(await stamps.stale(vitest)).toEqual([]);

          writeFileSync(file, 'export const which = "newer";\n');
          expect(await stamps.stale(vitest)).toEqual([file]);
        } finally {
          await server.close();
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }
});
