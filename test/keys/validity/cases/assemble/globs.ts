import type { Case } from "../../case.js";

/*
 * Row 023-13 (fix A, `023 research/glob-membership.md` 2): the runner
 * reports the folders a closure's modules glob; the core keeps them per
 * module and keys every closure that holds the module with their listings.
 * A tree before 023-13 ignores the report, so the keys differ there and
 * nothing a key reads is stored differently: a re-key, no raise. The second
 * file's closure holds the glob module with no report of its own, as a list
 * a daemon stored before the release, and takes its listings from the set.
 */

const A = "test/a.test.ts";
const B = "test/b.test.ts";

const FILES = {
  "src/registry.ts": 'export const plugins = import.meta.glob("./plugins/*.ts");\n',
  "src/pages.ts": 'export const pages = import.meta.glob("./pages/**/*.ts");\n',
  "src/plugins/kept.ts": "export const kept = 1;\n",
  "src/pages/home.ts": "export const home = 1;\n",
  "src/pages/deep/about.ts": "export const about = 1;\n",
  [A]: "import '../src/registry';\nimport '../src/pages';\n",
  [B]: "import '../src/registry';\n",
};

const GLOBS = [
  { path: "src/pages.ts", directories: ["src/pages"], recursive: ["src/pages"] },
  { path: "src/registry.ts", directories: ["src/plugins"], recursive: [] },
];

export const GLOB_LISTINGS: readonly Case[] = [
  {
    kind: "assemble",
    name: "closures whose modules glob a folder, flat and recursive (row 023-13)",
    why: "023-13 (fix A): a module's glob folders key every closure that holds it, a list stored without the report included; a re-key where the last release ignored the report",
    input: {
      files: FILES,
      closures: [
        {
          path: A,
          imports: [
            "src/registry.ts",
            "src/pages.ts",
            "src/plugins/kept.ts",
            "src/pages/home.ts",
            "src/pages/deep/about.ts",
          ],
          globs: GLOBS,
        },
        { path: B, imports: ["src/registry.ts", "src/plugins/kept.ts"] },
      ],
    },
  },
];
