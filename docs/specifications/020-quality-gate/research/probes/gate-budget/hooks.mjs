// Throwaway (row 020-41): when do Vitest's module hooks fire? Writes a project with
// <n> test files of 2 s each, run one at a time (maxWorkers 1), and a reporter that
// logs the seconds of onTestModuleQueued, onTestModuleStart and onTestModuleEnd.
// node hooks.mjs <dir> <node_modules> <n>; then run <dir>/node_modules/.bin/vitest run in <dir>.
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, modules, nArg] = process.argv.slice(2);
const n = Number(nArg);
mkdirSync(join(dir, "test"), { recursive: true });
writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "hooks", private: true, type: "module" })}\n`);
writeFileSync(
  join(dir, "vitest.config.ts"),
  `import { defineConfig } from "vitest/config";\nimport Stamp from "./stamp-reporter.ts";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], maxWorkers: 1, reporters: [new Stamp()] } });\n`,
);
writeFileSync(
  join(dir, "stamp-reporter.ts"),
  `const t0 = performance.now();
const s = () => ((performance.now() - t0) / 1000).toFixed(2);
const name = (m: { moduleId: string }) => m.moduleId.split("/").pop();
export default class Stamp {
  onTestRunStart(specs: readonly unknown[]) { console.error(\`\${s()} runStart \${specs.length}\`); }
  onTestModuleQueued(m: { moduleId: string }) { console.error(\`\${s()} queued \${name(m)}\`); }
  onTestModuleStart(m: { moduleId: string }) { console.error(\`\${s()} start \${name(m)}\`); }
  onTestModuleEnd(m: { moduleId: string }) { console.error(\`\${s()} end \${name(m)}\`); }
}
`,
);
for (let i = 1; i <= n; i++) {
  writeFileSync(
    join(dir, "test", `f${i}.test.ts`),
    `import { it } from "vitest";\nit("f${i}", async () => { await new Promise((r) => setTimeout(r, 2000)); });\n`,
  );
}
symlinkSync(modules, join(dir, "node_modules"));
