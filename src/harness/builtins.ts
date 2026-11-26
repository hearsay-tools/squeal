import { isBuiltin } from "node:module";
import type { Plugin } from "esbuild";

/*
 * Row 025-16 (`research/hook-bundles.md` sections 2 and 4, `builtins`): every
 * Node bundle reads its builtins through `process.getBuiltinModule` instead of
 * a static `import ... from "node:x"`. Importing a builtin from ESM builds a
 * namespace of all its exports, which reads every lazy getter (`fs.promises`,
 * `crypto.webcrypto` ...): about 6 of the 11.5 to 15 ms each hook paid for its
 * builtins. Each builtin becomes a virtual module whose every export is a pure
 * call, so esbuild drops the exports no module uses and the output does not
 * depend on the Node that builds it, as long as that Node has every used one.
 */

/** The esbuild namespace of the virtual builtin modules. */
export const BUILTIN_NAMESPACE = "squeal-builtin";

/** `node:x` for a builtin imported as `x` or `node:x`; undefined for anything else. */
export function builtinId(path: string): string | undefined {
  if (!isBuiltin(path)) return undefined;
  return path.startsWith("node:") ? path : `node:${path}`;
}

/** An export name the module can declare; never one starting with `$`, the helpers' prefix. */
const IDENTIFIER = /^[A-Za-z_][\w$]*$/;

/**
 * The virtual module of builtin `id`: one export per named export of the
 * building Node's module, sorted so the output keeps one order on every Node,
 * and the module itself as the default export.
 */
export function builtinSource(id: string): string {
  const mod = process.getBuiltinModule(id) as Record<string, unknown>;
  const names = Object.keys(mod)
    .filter((n) => IDENTIFIER.test(n) && n !== "default")
    .sort();
  // The helpers' `$` names stay apart from every export name: `node:http` exports a `get`.
  return [
    "let $mod;",
    `const $load = () => ($mod ??= process.getBuiltinModule(${JSON.stringify(id)}));`,
    "const $pick = (n) => $load()[n];",
    ...names.map((n) => `export const ${n} = /* @__PURE__ */ $pick(${JSON.stringify(n)});`),
    "export default /* @__PURE__ */ $load();",
  ].join("\n");
}

/**
 * Turns each `import` and `import()` of a builtin into the virtual module of
 * `builtinSource`. A `require` of one stays as it is: the banner's `require`
 * (`bundleOptions`) loads it without the ESM facade.
 */
export function builtinsPlugin(): Plugin {
  return {
    name: "squeal-builtins",
    setup(build) {
      build.onResolve({ filter: /^(node:)?[a-z0-9_]+(\/[a-z0-9_]+)?$/ }, (args) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        const id = builtinId(args.path);
        return id === undefined ? undefined : { path: id, namespace: BUILTIN_NAMESPACE };
      });
      build.onLoad({ filter: /.*/, namespace: BUILTIN_NAMESPACE }, (args) => ({
        contents: builtinSource(args.path),
        loader: "js",
      }));
    },
  };
}
