// Throwaway probe for 016-34: the one provider every binding wraps.
// Two checks with the same call shape:
// - "trivial": units are checks/*.check.js; each imports one src/*.js. A run
//   reads the unit and passes unless it holds "FAIL".
// - "eslint": units are src/*.js; a run lints them with ESLint's Node API,
//   one ESLint instance per provider (loaded on the first run, kept warm).
// invalidate drops cached file text; affected and closure read imports by a
// regex. Nothing here knows which binding carries it.
// `fault` (question 4) makes run misbehave: "throw" rejects, "throw-async"
// throws from a timer and never settles, "block" holds its thread for
// BLOCK_MS in Atomics.wait (asleep, no CPU), "hang" never settles.
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, normalize } from "node:path";

export const BLOCK_MS = 3000;
const IMPORT = /from\s+["'](\.[^"']+)["']/g;

export function createProvider({ root, check, eslintDir, fault = null }) {
  const texts = new Map();
  let eslint = null;
  const read = (path) => {
    let text = texts.get(path);
    if (text === undefined) {
      text = readFileSync(join(root, path), "utf8");
      texts.set(path, text);
    }
    return text;
  };
  const importsOf = (path) => [...read(path).matchAll(IMPORT)].map((m) => normalize(join(dirname(path), m[1])));
  const units = () => {
    const dir = check === "trivial" ? "checks" : "src";
    return readdirSync(join(root, dir))
      .filter((n) => n.endsWith(".js"))
      .map((n) => `${dir}/${n}`)
      .sort();
  };
  return {
    invalidate(paths) {
      for (const { path } of paths) texts.delete(path);
      return { recreatedProjects: [] };
    },
    affected(paths) {
      const changed = new Set(paths);
      const direct =
        check === "trivial"
          ? units().filter((u) => changed.has(u) || importsOf(u).some((i) => changed.has(i)))
          : units().filter((u) => changed.has(u));
      return { direct, transitive: [] };
    },
    closure(unit) {
      return { testFile: unit, paths: [unit, ...importsOf(unit)] };
    },
    // A scheduling hint, answered from local state only (question 3).
    tierWidth(_unit, grant) {
      return Math.max(1, Math.min(grant, 4));
    },
    async run(files) {
      if (fault === "throw") throw new Error("provider fault: throw");
      if (fault === "throw-async") {
        setTimeout(() => {
          throw new Error("provider fault: throw-async");
        }, 0);
        return new Promise(() => {});
      }
      if (fault === "block") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, BLOCK_MS);
      if (fault === "hang") return new Promise(() => {});
      if (check === "trivial") {
        const results = files.map((file) => ({
          file,
          outcome: read(file).includes("FAIL") ? "fail" : "pass",
          messages: [],
        }));
        return { end: "completed", completedFiles: files, results };
      }
      if (eslint === null) {
        const require = createRequire(join(eslintDir, "package.json"));
        const { ESLint } = require("eslint");
        eslint = new ESLint({ cwd: root });
      }
      const linted = await eslint.lintFiles(files.map((f) => join(root, f)));
      const results = linted.map((r) => ({
        file: r.filePath.slice(root.length + 1),
        outcome: r.errorCount > 0 ? "fail" : "pass",
        messages: r.messages.map((m) => ({ rule: m.ruleId, line: m.line, column: m.column, message: m.message })),
      }));
      return { end: "completed", completedFiles: files, results };
    },
  };
}
