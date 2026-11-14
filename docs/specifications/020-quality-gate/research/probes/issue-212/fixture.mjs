// Throwaway (row 020-56, #212): a git repository shaped like #212.
// node fixture.mjs <dir> <N> <sleepMs> <edit> <node_modules>
// - Vitest, one project, `setupFiles: ["./vitest.setup.ts"]`: every test file loads the setup file.
// - vitest.setup.ts: `resetEnv` (called in beforeEach, so every file runs it) and
//   `makeClock` (on globalThis; only every 10th test file calls it), plus top-level code.
// - src/m<k>.ts: 30 modules; test file i imports src/m<i % 30>.ts.
// - src/p1.ts .. p6.ts ("preview files"): each imported by 3 test files (t0..t17 import p<1 + i % 6>).
// - N test files test/t<i>.test.ts, each with one test that sleeps <sleepMs> (no CPU) and asserts.
// Base commit on "main"; the working tree then gets <edit>. With EDIT_ONLY=1 the repository
// must exist and only <edit> is written over its working tree.
// - "setup":  resetEnv and makeClock gain a branch (behaviour unchanged), p1..p6 gain a branch.
// - "breaks": as "setup", but makeClock now returns 1 more: the files that call it fail.
// - "top":    only top-level setup code changes (no function), p1..p6 gain a branch.
// - "setup2": as "setup" with another constant, so the keys move again (for a warm-store rerun).
// - "setup3": as "setup2" with a third constant.
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [dir, nArg, sleepArg, edit, modules] = process.argv.slice(2);
const N = Number(nArg);
const sleep = Number(sleepArg);
// CLOCK_FROM=k: only test files with i >= k call makeClock (default 0: every 10th file from t0).
const clockFrom = Number(process.env.CLOCK_FROM ?? 0);
const files = {
  "package.json": `${JSON.stringify({ name: "issue-212", private: true, type: "module" })}\n`,
  ".gitignore": "node_modules\n",
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"], setupFiles: ["./vitest.setup.ts"] } });\n`,
};
const setup = ({ reset, clock, top, bump = 0 }) =>
  [
    `import { beforeEach } from "vitest";`,
    `export const SETUP_MARK = ${top};`,
    `export function resetEnv(): void {`,
    ...(reset ? [`  if (process.env.PROBE_NEVER) delete process.env.PROBE_NEVER;`] : []),
    `  process.env.PROBE_MODE = "test";`,
    `}`,
    `export function makeClock(start: number): number {`,
    ...(clock === null ? [] : [`  if (start < 0) return ${clock};`]),
    `  return start + ${bump};`,
    `}`,
    `(globalThis as Record<string, unknown>).makeClock = makeClock;`,
    `beforeEach(() => resetEnv());`,
    ``,
  ].join("\n");
files["vitest.setup.ts"] = setup({ reset: false, clock: null, top: 0 });
for (let k = 0; k < 30; k++) {
  files[`src/m${k}.ts`] = `export function m${k}(x: number): number {\n  return x + ${k};\n}\n`;
}
const preview = (j, edited) =>
  `export function p${j}(x: number): number {\n${edited ? "  if (x < 0) return 0;\n" : ""}  return x * ${j};\n}\n`;
for (let j = 1; j <= 6; j++) files[`src/p${j}.ts`] = preview(j, false);
for (let i = 0; i < N; i++) {
  const k = i % 30;
  const lines = [`import { expect, it } from "vitest";`, `import { m${k} } from "../src/m${k}";`];
  const checks = [`expect(m${k}(1)).toBe(${1 + k});`];
  if (i < 18) {
    const j = 1 + (i % 6);
    lines.push(`import { p${j} } from "../src/p${j}";`);
    checks.push(`expect(p${j}(2)).toBe(${2 * j});`);
  }
  if (i % 10 === 0 && i >= clockFrom) {
    checks.push(`expect((globalThis as { makeClock: (n: number) => number }).makeClock(5)).toBe(5);`);
  }
  checks.push(`expect(process.env.PROBE_MODE).toBe("test");`);
  const wait = sleep > 0 ? `await new Promise((r) => setTimeout(r, ${sleep})); ` : "";
  lines.push(`it("t${i}", async () => { ${wait}${checks.join(" ")} });`, ``);
  files[`test/t${i}.test.ts`] = lines.join("\n");
}
const write = (path, text) => {
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), text);
};
if (process.env.EDIT_ONLY !== "1") {
  for (const [path, text] of Object.entries(files)) write(path, text);
  symlinkSync(modules, join(dir, "node_modules"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  const id = ["-c", "user.email=p@example.invalid", "-c", "user.name=probe"];
  git("init", "-q", "-b", "main");
  git(...id, "add", "-A");
  git(...id, "commit", "-qm", "base");
}
const previews = () => {
  for (let j = 1; j <= 6; j++) write(`src/p${j}.ts`, preview(j, true));
};
if (edit === "setup") write("vitest.setup.ts", setup({ reset: true, clock: 0, top: 0 }));
if (edit === "setup2") write("vitest.setup.ts", setup({ reset: true, clock: 7, top: 0 }));
if (edit === "setup3") write("vitest.setup.ts", setup({ reset: true, clock: 9, top: 0 }));
if (edit === "breaks") write("vitest.setup.ts", setup({ reset: true, clock: 0, top: 0, bump: 1 }));
if (edit === "top") write("vitest.setup.ts", setup({ reset: false, clock: null, top: 1 }));
previews();
