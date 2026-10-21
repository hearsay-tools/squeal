// Throwaway probe for 011-81: the parts of each root's environment hash.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [codeRoot, ...roots] = process.argv.slice(2);
if (codeRoot === undefined || roots.length === 0) throw new Error("usage: parts.ts <code-root> <root>...");
const keys = await import(join(codeRoot, "src/core/keys/index.ts"));
const { createVitestAdapter } = await import(join(codeRoot, "src/runners/vitest/index.ts"));
const sha = (value: unknown) =>
  createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 12);

for (const root of roots) {
  const adapter = await createVitestAdapter({ root, maxWorkers: 1 });
  try {
    const envs = await adapter.environment();
    const installed = await keys.installedDependencies(root, root);
    for (const env of envs) {
      const deps = keys.dependencyKeys(installed, env.packages);
      const opaqueBuiltins = env.packages.builtins.filter((b: string) => keys.OPAQUE_BUILTINS.has(b));
      const files = [...new Set<string>(env.files)].sort().map((path) => {
        let hash = "absent";
        try { hash = sha(readFileSync(join(root, path))); } catch {}
        return [path, hash];
      });
      console.log(JSON.stringify({
        root,
        project: env.project,
        fingerprint: installed.fingerprint.slice(0, 12),
        graphUsable: installed.graph !== null,
        staleNote: installed.note,
        patches: installed.patches.slice(0, 12),
        environmentOpaqueBuiltins: opaqueBuiltins,
        environmentDependencyInput: deps.environment.slice(0, 12),
        environmentInputIsWholeFingerprint: deps.environment === installed.fingerprint,
        perFileSegmentForNoPackages: deps.of(undefined).slice(0, 18),
        // Counterfactual: the scoped input had the environment not been opaque.
        scopedIfNotOpaque:
          installed.graph === null ? null : sha([installed.graph.identities(env.packages.imports), installed.patches]),
        environmentHash: keys
          .environmentHash(
            keys.coreEnvironmentInputs({ squealVersion: "x", installedDependencies: deps.environment, allowlist: [] , env: {} }),
            env,
            (path: string) => { try { return sha(readFileSync(join(root, path))); } catch { return null; } },
          )
          .slice(0, 12),
        runnerName: env.runnerName,
        runnerVersion: env.runnerVersion,
        adapterVersion: env.adapterVersion,
        resolvedConfig: sha(env.resolvedConfig),
        runnerFiles: files,
      }, null, 1));
    }
  } finally {
    await adapter.close();
  }
}
