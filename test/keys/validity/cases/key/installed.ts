import type { Case, KeyInput } from "../../case.js";
import { GOLDEN_KEYS } from "./golden.js";

/* Task 011-85: keys over a written install, whose fingerprint is the installed-dependency input. */

const [golden] = GOLDEN_KEYS;
if (golden?.kind !== "key") throw new Error("golden key case missing");

const lockfile = {
  name: "app",
  version: "1.4.0",
  lockfileVersion: 3,
  requires: true,
  packages: {
    "node_modules/a": { version: "1.0.0", integrity: "sha512-a" },
    "packages/w": { name: "w", version: "2.0.0", dependencies: { a: "^1.0.0" } },
  },
};

/** An importer with a linked workspace package and a registry dependency (R3). */
const pnpm = [
  "lockfileVersion: '9.0'",
  "",
  "importers:",
  "",
  "  .:",
  "    dependencies:",
  "      w:",
  "        specifier: ^2.0.0",
  "        version: link:packages/w",
  "      a:",
  "        specifier: ^1.0.0",
  "        version: 1.0.0",
  "",
].join("\n");

/** The folders first, the hidden lockfile last, so npm would trust it. */
const npm: Readonly<Record<string, string>> = {
  "node_modules/a/package.json": '{"name":"a","version":"1.0.0"}',
  "node_modules/.package-lock.json": JSON.stringify(lockfile),
};

const over = (installed: Readonly<Record<string, string>>): KeyInput => ({
  ...golden.input,
  installed,
});

export const INSTALLED_KEYS: readonly Case[] = [
  {
    kind: "key",
    name: "a trusted hidden lockfile",
    why: "011-85 (R1): the hidden lockfile without the root's and the workspaces' own versions",
    input: over(npm),
  },
  {
    kind: "key",
    name: "a stale hidden lockfile",
    why: "011-85 (R1): a folder the lockfile does not list keys the install by its package folders",
    input: over({ "node_modules/b/package.json": '{"name":"b","version":"1.0.0"}', ...npm }),
  },
  {
    kind: "key",
    name: "an installed pnpm lockfile",
    why: "011-85 (R3): pnpm's lock.yaml without a linked dependency's range",
    input: over({ "node_modules/.pnpm/lock.yaml": pnpm }),
  },
  {
    kind: "key",
    name: "an installed yarn state",
    why: "011-85: every other lockfile format keys its file whole",
    input: over({ "node_modules/.yarn-state.yml": "__metadata:\n  version: 1\n" }),
  },
];
