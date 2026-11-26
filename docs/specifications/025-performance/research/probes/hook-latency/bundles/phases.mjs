// Throwaway probe (row 025-14). From one hook dist, writes four stripped
// copies whose start-up cost differences split a hook run into phases:
//   empty     an empty module: Node's own start and exit
//   builtins  only the bundle's `node:` imports
//   parse     the whole bundle, its body behind an `if` that never holds:
//             read, parse and compile, nothing evaluated
//   eval      the whole bundle without its last `await runMain(...)`:
//             every module's top-level code, no hook work
// The full bundle is the fifth phase (the hook's own work).
// Usage: node phases.mjs <distIn> <outRoot>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [from, outRoot] = process.argv.slice(2);
const hooks = readdirSync(from).filter((f) => f.endsWith(".mjs"));
for (const v of ["empty", "builtins", "parse", "eval"]) {
  mkdirSync(join(outRoot, v), { recursive: true });
  // Bundles find the CLI beside them; keep it reachable.
  if (existsSync(join(from, "cli"))) cpSync(join(from, "cli"), join(outRoot, v, "cli"), { recursive: true });
}
for (const f of hooks) {
  const text = readFileSync(join(from, f), "utf8");
  const re = /^import\s[^;]*?from "node:[^"]+";\n/gm;
  const imports = text.match(re) ?? [];
  const body = text.replace(re, "");
  const last = text.lastIndexOf("await runMain(");
  writeFileSync(join(outRoot, "empty", f), "\n");
  writeFileSync(join(outRoot, "builtins", f), `${imports.join("")}`);
  writeFileSync(
    join(outRoot, "parse", f),
    `${imports.join("")}if (process.env.SQUEAL_PROBE_NEVER === "1") {\n${body}\n}\n`,
  );
  writeFileSync(join(outRoot, "eval", f), `${text.slice(0, last)}\n`);
}
