// Probe 011-85: each project's config file and environment files, as the adapter reports them.
import { join } from "node:path";
const [codeRoot, ...roots] = process.argv.slice(2);
const { createVitestAdapter } = await import(join(codeRoot!, "src/runners/vitest/index.ts"));
for (const root of roots) {
  const adapter = await createVitestAdapter({ root, maxWorkers: 1 });
  try {
    for (const env of await adapter.environment()) {
      console.log(JSON.stringify({ root: root.split("/").pop(), project: env.project, files: env.files.filter((f: string) => /config|sequencer/.test(f)) }));
    }
  } finally {
    await adapter.close();
  }
}
