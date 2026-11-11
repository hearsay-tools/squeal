import type { Case } from "../../case.js";

/*
 * Spec 020 D15.1 (row 020-16b): `nodeTest[].prepare` is a command that only
 * `squeal code --base` runs; it is in no key, and the daemon does not open
 * an entry that has one. The last release reads `prepare` as an unknown key
 * and skips the entry; this tree keeps a valid one. Neither keys a file of
 * such an entry, so the Vitest file's key equals the last release's. The
 * entries reach each rule of the key's check: a valid command with a
 * timeout, then a shell string, an unknown key, a command string and a
 * timeout of 0, each left out.
 */

const FAST = "test/fast.test.ts";

const entry = (name: string, prepare: unknown) => ({
  name,
  include: [`${name}/*.test.mjs`],
  prepare,
});

const NODE_TEST = [
  entry("package", { command: ["node", "scripts/build.mjs"], timeoutSeconds: 600 }),
  entry("shell", "npm run build"),
  entry("unknown", { command: ["node"], shell: true }),
  entry("string", { command: "npm run build" }),
  entry("zero", { command: ["node"], timeoutSeconds: 0 }),
];

export const PREPARE: readonly Case[] = [
  {
    kind: "assemble",
    name: "a repository whose node:test entries declare prepare",
    why: "020-16b: prepare is in no key, and no file of such an entry is keyed, so the keys equal the last release's, which skips the entry",
    input: {
      files: {
        "squeal.config.json": `${JSON.stringify({ nodeTest: NODE_TEST })}\n`,
        "src/app.ts": "export const app = 1;\n",
        [FAST]: "import '../src/app';\n",
      },
      closures: [{ path: FAST, imports: ["src/app.ts"] }],
    },
  },
];
