import { describe, expect, it } from "vitest";
import { observe } from "./helpers.js";

/*
 * Task 011-60 (gh-56; spec 011 C3, C12; research issue-56 F1): a failed
 * import of a missing script records the path it names, so creating the
 * script re-keys the test file. Only a `file:` or relative target: a bare
 * specifier names no path, and no candidate is guessed.
 */
describe("observe recorder: a failed import (task 011-60)", { timeout: 60_000 }, () => {
  it("records the exact file: or relative target of a failed import, in a child too, and rethrows", () => {
    const seen = observe({
      "main.mjs": [
        'import { execFileSync } from "node:child_process";',
        "const run = (...args) => {",
        "  try {",
        "    execFileSync(process.execPath, args, { stdio: 'ignore' });",
        "    return 'ok';",
        "  } catch {",
        "    return 'failed';",
        "  }",
        "};",
        'const url = new URL("./scripts/missing.mjs", import.meta.url).href;',
        "const esm = (code) => run('--input-type=module', '--eval', code);",
        "const out = [",
        // the incident's shape: a child imports a script by its file: URL
        '  esm("import register from \'" + url + "?v=1\'; register();"),',
        "  esm(\"import './scripts/relative.mjs';\"),",
        "  run('-e', \"require('./scripts/required.cjs')\"),",
        "  esm(\"import 'missing-package';\"),",
        "  esm(\"import './scripts/present.mjs';\"),",
        "];",
        'const own = await import("./lib/absent.mjs").catch((e) => e.code);',
        "process.stdout.write(JSON.stringify([...out, own]));",
      ].join("\n"),
      "scripts/present.mjs": "export {};\n",
    });
    // each caller sees the failure it would without Squeal
    expect(JSON.parse(seen.stdout)).toEqual([
      "failed",
      "failed",
      "failed",
      "failed",
      "ok",
      "ERR_MODULE_NOT_FOUND",
    ]);
    expect(seen.paths).toEqual([
      "lib/absent.mjs",
      "main.mjs",
      "scripts/missing.mjs",
      "scripts/present.mjs",
      "scripts/relative.mjs",
      "scripts/required.cjs",
    ]);
  });
});
