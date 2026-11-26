// Throwaway probe (row 025-14). Builds the Claude Code hook bundles into a
// scratch directory with the product's `bundleOptions`, plus one variant's
// overrides, and writes the metafile beside them. Never writes `dist`.
// Usage: tsx build-variant.ts <outdir> <variant>[+<variant>...] [repoRoot]
//   base      the product options, external source maps
//   minify    + minifyWhitespace + minifySyntax
//   split     + splitting across the hook entries only (shared chunks)
//   builtins  every `node:` import read with process.getBuiltinModule, no ESM facade
//   lazy      builtins, and node:child_process and node:zlib loaded on first call
//   cut       never-called module groups replaced by stubs: the upper bound of
//             making their imports `await import()` (the rare path is never run here)
// The hook bundles alone are built (the CLI and workers are copied from `base`).
import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type BuildOptions, build, type Plugin } from "esbuild";

const [outdir, variants = "base", root = process.cwd()] = process.argv.slice(2);
const { bundleOptions } = (await import(join(resolve(root), "src/harness/claude-code/build.ts"))) as {
  bundleOptions: (outdir: string) => BuildOptions;
};
const base = bundleOptions(resolve(outdir as string));
const hooksOnly = (base.entryPoints as { in: string; out: string }[]).filter((e) => !e.out.includes("/"));

const LAZY = new Set(["node:child_process", "node:zlib"]);

/** `node:` imports as virtual modules over process.getBuiltinModule; `lazy` ones call through on first use. */
function builtins(lazy: boolean): Plugin {
  return {
    name: "builtins",
    setup(b) {
      b.onResolve({ filter: /^node:/ }, (a) =>
        a.namespace === "builtin" ? { path: a.path, external: true } : { path: a.path, namespace: "builtin" },
      );
      b.onLoad({ filter: /.*/, namespace: "builtin" }, (a) => {
        const mod = process.getBuiltinModule(a.path) as Record<string, unknown>;
        const names = Object.keys(mod).filter((n) => /^[A-Za-z_$][\w$]*$/.test(n) && n !== "default");
        const isLazy = lazy && LAZY.has(a.path);
        const lines = [
          `let m;`,
          `const get = () => (m ??= process.getBuiltinModule(${JSON.stringify(a.path)}));`,
          // A pure call per export, so esbuild drops the exports no module imports.
          `const pick = (n) => get()[n];`,
        ];
        for (const n of names) {
          if (isLazy && typeof mod[n] === "function") {
            lines.push(
              `export function ${n}(...args) { const f = get().${n}; return new.target ? Reflect.construct(f, args) : f.apply(this, args); }`,
              `Object.defineProperty(${n}, Symbol.for("nodejs.util.promisify.custom"), { get: () => get().${n}[Symbol.for("nodejs.util.promisify.custom")] });`,
            );
          } else if (isLazy) {
            lines.push(`export const ${n} = new Proxy({}, { get: (_, k) => get().${n}[k] });`);
          } else {
            lines.push(`export const ${n} = /* @__PURE__ */ pick(${JSON.stringify(n)});`);
          }
        }
        return { contents: lines.join("\n"), loader: "js", resolveDir: root };
      });
    },
  };
}

/** Modules whose subtree no timed hook run calls (dominated.mjs, coverage of every case). Not
 * keys/pnpm-lockfile: keys/environment reads its PNPM_LOCKFILE at load. */
const CUT = process.env.PROBE_CUT?.split(",") ?? [
  "src/core/code/store/store.ts",
  "src/core/status/outstanding.ts",
  "src/core/keys/pnpm-install.ts",
  "src/core/lint/store/open.ts",
  "src/core/store/prune.ts",
  "src/core/delivery/code-coverage.ts",
  "src/core/status/imports.ts",
];

/** Replaces each of `CUT` by a module exporting the same value names as throwing stubs. */
function cut(): Plugin {
  const abs = new Set(CUT.map((p) => join(resolve(root), p)));
  return {
    name: "cut",
    setup(b) {
      b.onLoad({ filter: /\.ts$/ }, (a) => {
        if (!abs.has(a.path)) return undefined;
        const src = readFileSync(a.path, "utf8");
        const names = new Set<string>();
        for (const m of src.matchAll(/^export (?:async )?(?:function\*?|const|let|class) (\w+)/gm)) names.add(m[1] as string);
        for (const m of src.matchAll(/^export \{([^}]*)\}/gm))
          for (const part of (m[1] as string).split(",")) {
            const n = part.trim().split(/\s+as\s+/).pop()?.trim();
            if (n && !n.startsWith("type ")) names.add(n);
          }
        const body = [
          `const stub = new Proxy(function () {}, { get: (t, k) => k === Symbol.iterator ? undefined : stub, apply: () => { throw new Error("cut: ${a.path}"); }, construct: () => { throw new Error("cut"); } });`,
          ...[...names].map((n) => `export const ${n} = stub;`),
        ];
        return { contents: body.join("\n"), loader: "js" };
      });
    },
  };
}

const parts = (variants as string).split("+");
const options: BuildOptions = { ...base, sourcemap: "external", entryPoints: hooksOnly, plugins: [] };
for (const v of parts) {
  if (v === "base") continue;
  else if (v === "minify") Object.assign(options, { minifyWhitespace: true, minifySyntax: true });
  else if (v === "split") Object.assign(options, { splitting: true, chunkNames: "chunks/[name]-[hash]" });
  else if (v === "builtins") options.plugins?.push(builtins(false));
  else if (v === "lazy") options.plugins?.push(builtins(true));
  else if (v === "cut") options.plugins?.unshift(cut());
  else throw new Error(`unknown variant ${v}`);
}
const { metafile } = await build(options);
writeFileSync(join(outdir as string, "meta.json"), JSON.stringify(metafile));
// The hooks spawn the CLI beside them; reuse the product's.
const cli = join(resolve(root), "plugins/claude-code/dist/cli");
if (!existsSync(join(outdir as string, "cli"))) cpSync(cli, join(outdir as string, "cli"), { recursive: true });
