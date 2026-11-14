// Throwaway probe (spec 022 research, loaded-modules). A Vitest setup file that,
// after each test file, writes the module runner's evaluated-modules map to
// $LM_OUT/<sanitised test path>.json. Reads Vitest internals:
// globalThis.__vitest_worker__.evaluatedModules (vite/module-runner EvaluatedModules).
import { afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

afterAll(() => {
  const out = process.env.LM_OUT;
  if (!out) return;
  const t0 = performance.now();
  const st = (globalThis as any).__vitest_worker__;
  const mods: any[] = [];
  for (const [id, n] of st.evaluatedModules.idToModuleMap as Map<string, any>) {
    mods.push({
      id,
      file: n.file,
      url: n.url,
      evaluated: n.evaluated,
      externalize: n.meta && "externalize" in n.meta ? n.meta.externalize : undefined,
      type: n.meta?.type,
      importers: [...(n.importers ?? [])],
    });
  }
  const readMs = performance.now() - t0;
  fs.mkdirSync(out, { recursive: true });
  const name = path.relative(process.cwd(), st.filepath).replace(/[\/\\]/g, "__");
  fs.writeFileSync(
    path.join(out, name + ".json"),
    JSON.stringify({ filepath: st.filepath, pid: process.pid, threadId: (globalThis as any).process?.threadId, readMs, mods }, null, 1),
  );
});
