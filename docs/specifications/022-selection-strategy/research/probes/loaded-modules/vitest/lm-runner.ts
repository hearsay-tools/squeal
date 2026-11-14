// Throwaway probe (spec 022 research, loaded-modules). A custom Vitest runner
// (`test.runner`) that writes the evaluated-modules map after each test file in
// onAfterRunFiles, which runs even when the file failed to import (collect error).
import { TestRunner } from "vitest";
import fs from "node:fs";
import path from "node:path";

export default class LoadedModulesRunner extends TestRunner {
  onAfterRunFiles(files: any[]) {
    super.onAfterRunFiles(files);
    const out = process.env.LM_OUT;
    if (!out) return;
    const t0 = performance.now();
    const st = (globalThis as any).__vitest_worker__;
    const mods: any[] = [];
    for (const [id, n] of st.evaluatedModules.idToModuleMap as Map<string, any>) {
      mods.push({
        id, file: n.file, url: n.url, evaluated: n.evaluated,
        externalize: n.meta && "externalize" in n.meta ? n.meta.externalize : undefined,
        type: n.meta?.type, importers: [...(n.importers ?? [])],
      });
    }
    const readMs = performance.now() - t0;
    fs.mkdirSync(out, { recursive: true });
    for (const f of files) {
      const name = path.relative(process.cwd(), f.filepath).replace(/[\/\\]/g, "__");
      fs.writeFileSync(path.join(out, name + ".json"), JSON.stringify({ filepath: f.filepath, via: "runner", pid: process.pid, readMs, mods }, null, 1));
    }
  }
}
