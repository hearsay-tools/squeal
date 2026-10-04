import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { WatchHint, WatchSpec, WatchSubscription } from "../../src/core/types/index.js";
import { createWatcherBackend } from "../../src/core/watcher/index.js";
import { delay, makeRepo, waitFor } from "./helpers.js";

/**
 * One contract, two backends. @parcel/watcher is the macOS backend; research
 * found it loses writes in renamed directories on Linux, so its suite runs only
 * on darwin and is skipped here on Linux.
 */
const BACKENDS = [
  { platform: "linux", name: "chokidar", run: true },
  { platform: "darwin", name: "parcel", run: process.platform === "darwin" },
] as const;

for (const { platform, name, run } of BACKENDS) {
  describe.runIf(run)(`${name} backend`, () => {
    let root: string;
    let cleanup: () => void;
    let hints: WatchHint[];
    let errors: Error[];
    let sub: WatchSubscription | null;

    const spec = (excluded: string[], extraFiles: string[] = []): WatchSpec => ({
      root,
      excluded: [".git", ...excluded].map((p) => join(root, p)),
      extraFiles: extraFiles.map((p) => join(root, p)),
    });
    const seen = (rel: string) => hints.some((h) => h.path === join(root, rel));
    const start = async (watchSpec: WatchSpec) => {
      sub = await createWatcherBackend(platform).watch(watchSpec, {
        onHints: (batch) => hints.push(...batch),
        onDropped: (reason) => errors.push(new Error(reason)),
        onError: (error) => errors.push(error),
      });
    };

    beforeEach(() => {
      ({ root, cleanup } = makeRepo());
      hints = [];
      errors = [];
      sub = null;
    });
    afterEach(async () => {
      await sub?.close();
      cleanup();
    });

    it("is selected for its platform", () => {
      expect(createWatcherBackend(platform).name).toBe(name);
    });

    it("reports a write after an atomic save", async () => {
      await start(spec(["out"]));
      writeFileSync(join(root, "src/a.ts.tmp"), "saved\n");
      renameSync(join(root, "src/a.ts.tmp"), join(root, "src/a.ts"));
      await waitFor(() => seen("src/a.ts"));
      await delay(200);
      hints = [];
      writeFileSync(join(root, "src/a.ts"), "written after the save\n");
      await waitFor(() => seen("src/a.ts"));
    });

    it("reports files written inside a renamed directory", async () => {
      await start(spec(["out"]));
      renameSync(join(root, "src/lib"), join(root, "src/moved"));
      await waitFor(() => seen("src/moved/b.ts"));
      await delay(200);
      hints = [];
      writeFileSync(join(root, "src/moved/b.ts"), "edited\n");
      writeFileSync(join(root, "src/moved/new.ts"), "new\n");
      await waitFor(() => seen("src/moved/b.ts") && seen("src/moved/new.ts"));
    });

    it("never reports excluded paths, but reports extra files inside them", async () => {
      await start(spec(["out"], ["out/gen.js"]));
      writeFileSync(join(root, "out/other.js"), "x\n");
      writeFileSync(join(root, "out/gen.js"), "regenerated\n");
      writeFileSync(join(root, "src/a.ts"), "edited\n");
      await waitFor(() => seen("src/a.ts") && seen("out/gen.js"));
      await delay(200);
      expect(seen("out/other.js")).toBe(false);
      expect(hints.some((h) => h.path.startsWith(join(root, ".git")))).toBe(false);
    });

    it("applies an updated spec to a live watch", async () => {
      mkdirSync(join(root, "tmp"));
      await start(spec(["out"]));
      await sub?.update(spec(["tmp"]));
      await delay(100);
      writeFileSync(join(root, "tmp/x.ts"), "x\n");
      writeFileSync(join(root, "out/y.js"), "y\n");
      writeFileSync(join(root, "src/a.ts"), "edited\n");
      await waitFor(() => seen("src/a.ts") && seen("out/y.js"));
      await delay(200);
      expect(seen("tmp/x.ts")).toBe(false);
      expect(errors).toEqual([]);
    });
  });
}
