// Throwaway probe (011-35): a guard over emitted code instead of source text.
// Bundles the validity path's entry points of a checkout with esbuild (tree
// shaken, comments and types gone), and prints the hash of the output with
// esbuild's `// path` module markers dropped, and how many inputs reach it.
//
//   node bundle.mjs <esbuild-dir> <checkout>...
// Each checkout should have KEY_FORMAT_VERSION patched to one value (golden.sh).
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const [esbuildDir, ...checkouts] = process.argv.slice(2);
const esbuild = createRequire(join(esbuildDir, "package.json"))("esbuild");

const SHARED = [
  ["src/core/keys/index.ts", "*"],
  ["src/core/scheduler/keying.ts", "*"],
  ["src/core/scheduler/records.ts", "*"],
  ["src/core/state/fingerprint.ts", "describeFailure"],
  ["src/core/scheduler/stability.ts", "*"],
  ["src/core/scheduler/store-results.ts", "*"],
  ["src/core/store/repos/results.ts", "*"],
  ["src/core/store/schema.ts", "*"],
  ["src/core/state/inherited.ts", "heldFailure"],
  ["src/core/scheduler/tiers.ts", "recordTier"],
];
const VARIANTS = {
  // Acceptance as the code holds it today: the whole Ledger class, and the runner adapters.
  "as-is": [
    ...SHARED,
    ["src/core/scheduler/ledger.ts", "Ledger"],
    ["src/runners/vitest/adapter.ts", "*"],
    ["src/runners/node-test/adapter.ts", "*"],
    ["src/runners/pytest/adapter.ts", "*"],
  ],
  // Without Ledger (its probe is ~10 lines over byKey and heldFailure) and without the
  // adapters, which their own versions cover (D4).
  "core-only": SHARED,
  // As core-only, without recordTier: what the guard holds once recordTier's
  // store-or-discard decision leaves tiers.ts, since recordTier keeps Ledger whole.
  "no-tiers": SHARED.filter(([path]) => !path.endsWith("/tiers.ts")),
};

for (const [variant, entries] of Object.entries(VARIANTS)) {
  console.log(`### ${variant}`);
  for (const root of checkouts) {
    const lines = [];
    let n = 0;
    for (const [path, names] of entries) {
      if (!existsSync(join(root, path))) continue;
      const spec = `./${path}`;
      lines.push(names === "*" ? `export * from "${spec}";` : `export { ${names} as e${n++} } from "${spec}";`);
    }
    const entry = join(root, `kfg-entry-${variant}.ts`);
    writeFileSync(entry, `${lines.join("\n")}\n`);
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      platform: "node",
      format: "esm",
      target: "node22.13",
      packages: "external",
      metafile: true,
      legalComments: "none",
      logLevel: "silent",
      absWorkingDir: root,
    });
    // The pin table grows at every raise by construction; it is not key code.
    const text = result.outputFiles[0].text
      .replace(/var KEY_SOURCES_HASHES = \{[^}]*\};/, "")
      .split("\n")
      .filter((line) => !/^\s*\/\/ /.test(line))
      .join("\n");
    const inputs = Object.values(result.metafile.outputs)[0].inputs;
    const used = Object.entries(inputs).filter(([, v]) => v.bytesInOutput > 0).length;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 12);
    if (process.env.KFG_OUT) writeFileSync(join(process.env.KFG_OUT, `${root.split("/").pop()}.${variant}.js`), text);
    if (process.env.KFG_OUT) writeFileSync(join(process.env.KFG_OUT, `${root.split("/").pop()}.${variant}.inputs`), Object.entries(inputs).filter(([, v]) => v.bytesInOutput > 0).map(([k]) => k).sort().join("\n") + "\n");
    console.log(`${root.split("/").pop()}\t${hash}\t${used} inputs\t${text.length} bytes`);
  }
}
