import type { Case } from "../../case.js";

/* A failed import of a missing script records the exact path it names; a bare one records nothing (011-60). */

export const FAILED_IMPORTS: readonly Case[] = [
  {
    kind: "observe",
    name: "a failed file:, relative, bare and entry-point import",
    why: "011-60 (gh-56): the absent target of a failed file: or relative import enters the observed set",
    input: {
      files: {
        "scripts/present.mjs": "export {};\n",
        "scripts/pre.cjs": "",
        "test/imports.test.js": "// the test file the script works for\n",
      },
      testFile: "test/imports.test.js",
      script: [
        'const { spawnSync } = require("node:child_process");',
        'const { pathToFileURL } = require("node:url");',
        'const esm = (code) => spawnSync(process.execPath, ["--input-type=module", "--eval", code]);',
        'esm("import \'" + pathToFileURL("scripts/missing.mjs").href + "?v=1\';");',
        "esm(\"import './scripts/relative.mjs';\");",
        "esm(\"import 'missing-package';\");",
        "esm(\"import 'file://host:port/bad.mjs';\");",
        "esm(\"import './scripts/present.mjs';\");",
        // a missing entry under a `--require` recorder resolves with no parent URL
        'spawnSync(process.execPath, ["--require", "./scripts/pre.cjs", "scripts/entry.cjs"]);',
        'try { require("./scripts/required.cjs"); } catch {}',
      ].join("\n"),
    },
  },
];
