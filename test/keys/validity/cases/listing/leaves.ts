import type { Case } from "../../case.js";

/*
 * Row 011-270 (review 0.1.379 B1): a file git ignored, which a closure
 * names, so the daemon watches it as an extra file, and which git then
 * sees. The candidate moves it out of the extra-file set at the revision
 * that shows it, and its directories' listings count it from there, as a
 * restart's do. A release before keeps it extra until a restart, so `.ai/`
 * lists no `qa` there. Each case then adds a tracked file, which every
 * tree counts, and deletes the path: the candidate takes back its own
 * count, and `.ai` stays in the root listing for the tracked
 * `.ai/notes.md`.
 */

const TEST = "test/a.test.ts";
const DATA = ".ai/qa/data.json";

const INPUT = {
  files: {
    ".gitignore": ".ai/qa/\n",
    ".ai/notes.md": "# notes\n",
    "src/app.ts": "export const app = 1;\n",
    [TEST]: "import '../src/app';\n",
  },
  untracked: { [DATA]: '{"v":1}\n' },
  environment: {
    project: "",
    runnerName: "validity",
    runnerVersion: "1",
    adapterVersion: "1",
    resolvedConfig: "{}",
    files: [],
  },
  closures: [{ path: TEST, imports: ["src/app.ts", DATA, "./", ".ai/", ".ai/qa/"] }],
} as const;

/** The tracked file added, then the path deleted. */
const LATER = [
  { files: { "src/added.ts": "export const added = 1;\n" } },
  { files: { [DATA]: null } },
] as const;

export const LEAVING_LISTING: readonly Case[] = [
  {
    kind: "assemble",
    name: "an extra file force-added and committed, rewritten, then a tracked add and its delete",
    why: "011-270: the rewrite's revision moves the path out of the extra-file set and `.ai/` lists `qa` for it, where a release before kept it extra until a restart; the keys differ, and the add and the delete move each tree's listings by its own count",
    input: {
      ...INPUT,
      revised: [
        {
          git: [
            ["add", "-f", DATA],
            ["commit", "-qm", "track the data"],
          ],
          files: { [DATA]: '{"v":22}\n' },
        },
        ...LATER,
      ],
    },
  },
  {
    kind: "assemble",
    name: "an extra file an ignore-rule removal shows, then a tracked add and its delete",
    why: "011-270: the `.gitignore` change's revision asks git about every extra file and moves the path out, where a release before kept it extra until a restart; the keys differ, and the add and the delete move each tree's listings by its own count",
    input: { ...INPUT, revised: [{ files: { ".gitignore": "dist/\n" } }, ...LATER] },
  },
];
