// Throwaway probe for research 025-22. Run from an installed bench-shaped project:
//   node probe.mjs <project dir> <provider.mjs path>
// Starts Vitest through its Node API with Squeal's custom coverage provider, as
// the daemon does (src/runners/vitest/adapter.ts #start, coverage.ts options()),
// runs one test file, and prints the error with its whole `cause` chain.
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [root, provider] = process.argv.slice(2);
const req = createRequire(join(root, "package.json"));
const version = (name) => {
  try {
    return req(`${name}/package.json`).version;
  } catch {
    // vite is a peer of vitest: resolve it from vitest's own directory.
    const viaVitest = createRequire(req.resolve("vitest/package.json"));
    return viaVitest(`${name}/package.json`).version;
  }
};
console.log(`node ${process.version} vitest ${version("vitest")} vite ${version("vite")}`);
const node = await import(pathToFileURL(req.resolve("vitest/node")).href);
const reportsDirectory = mkdtempSync(join(tmpdir(), "probe-coverage-"));
let vitest;
try {
  vitest = await node.createVitest("test", {
    root,
    watch: false,
    reporters: [],
    update: "none",
    includeTaskLocation: true,
    fsModuleCache: false,
    coverage: { enabled: true, provider: "custom", customProviderModule: provider, reporter: [], reportsDirectory },
  });
  await vitest.standalone();
  const files = (await vitest.globTestSpecifications()).slice(0, 1);
  await vitest.runTestSpecifications(files);
  console.log(`OK: ran ${files.length} file(s); state errors: ${vitest.state.getUnhandledErrors().length}`);
} catch (error) {
  let e = error;
  let depth = 0;
  while (e) {
    console.log(`--- error depth ${depth}: ${e?.constructor?.name}`);
    console.log(e?.stack ?? String(e));
    if (e?.code) console.log(`code: ${e.code}`);
    e = e?.cause;
    depth++;
  }
  process.exitCode = 1;
} finally {
  await vitest?.close();
}
