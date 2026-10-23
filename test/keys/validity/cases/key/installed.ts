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

/*
 * Task 011-162 R2: pnpm's default layout, whose `lock.yaml` gives per-package keys while it stands
 * for the install. Package folders first, `lock.yaml` last, so the trust rule holds. The second
 * `.pnpm` folder is a name pnpm cut and hashed (cezar's, pnpm 12.11.2).
 */
const CSS_CALC =
  "@csstools/css-calc@3.2.1(@csstools/css-parser-algorithms@4.0.0(@csstools/css-tokenizer@4.0.0))(@csstools/css-tokenizer@4.0.0)";
const CSS_CALC_FOLDER =
  "@csstools+css-calc@3.2.1_@csstools+css-parser-algorithms@4.0.0_@csstools+css-tokenizer@_3b33f237655dfa7a35d4b0433ee15cf1";

const pnpmLock = [
  "lockfileVersion: '9.0'",
  "",
  "settings:",
  "  autoInstallPeers: true",
  "",
  "importers:",
  "",
  "  .:",
  "    devDependencies:",
  "      vitest:",
  "        specifier: ^4.0.0",
  "        version: 4.0.0",
  "    dependenciesMeta:",
  "      lib:",
  "        injected: false",
  "",
  "  packages/app:",
  "    dependencies:",
  "      a:",
  "        specifier: ^1.0.0",
  "        version: 1.0.0",
  "      alias:",
  "        specifier: npm:real@^1.0.0",
  "        version: real@1.0.0",
  "      lib:",
  "        specifier: workspace:*",
  "        version: link:../lib",
  "      p:",
  "        specifier: ^1.0.0",
  "        version: 1.0.0(q@1.0.0)",
  "      pub:",
  "        specifier: ^1.0.0",
  "        version: 1.0.0",
  "      tarball:",
  "        specifier: https://example.com/tarball.tgz",
  "        version: 1.0.0",
  "",
  "packages:",
  "",
  "  '@csstools/css-calc@3.2.1':",
  "    resolution: {integrity: sha512-css-calc}",
  "    engines: {node: '>=20.19.0'}",
  "",
  "  '@types/x@1.0.0':",
  "    resolution: {integrity: sha512-types-x}",
  "",
  "  a@1.0.0:",
  "    resolution: {integrity: sha512-a}",
  "",
  "  b@1.0.0:",
  "    resolution: {integrity: sha512-b}",
  "",
  "  fsevents@2.3.3:",
  "    resolution: {integrity: sha512-fsevents}",
  "    os: [darwin]",
  "",
  "  p@1.0.0:",
  "    resolution: {integrity: sha512-p}",
  "    peerDependencies:",
  "      q: ^1",
  "",
  "  pub@1.0.0:",
  "    resolution: {integrity: sha512-pub}",
  "",
  "  q@1.0.0:",
  "    resolution: {integrity: sha512-q}",
  "",
  "  real@1.0.0:",
  "    resolution: {integrity: sha512-real}",
  "",
  "  tarball@1.0.0:",
  "    resolution: {tarball: https://example.com/tarball.tgz}",
  "",
  "  vitest@4.0.0:",
  "    resolution: {integrity: sha512-vitest}",
  "",
  "snapshots:",
  "",
  `  '${CSS_CALC}': {}`,
  "",
  "  '@types/x@1.0.0': {}",
  "",
  "  a@1.0.0:",
  "    dependencies:",
  "      '@types/x': 1.0.0",
  "      b: 1.0.0",
  "    optionalDependencies:",
  "      fsevents: 2.3.3",
  "",
  "  b@1.0.0: {}",
  "",
  "  fsevents@2.3.3:",
  "    optional: true",
  "",
  "  p@1.0.0(q@1.0.0):",
  "    dependencies:",
  "      q: 1.0.0",
  "",
  "  pub@1.0.0: {}",
  "",
  "  q@1.0.0: {}",
  "",
  "  real@1.0.0: {}",
  "",
  "  tarball@1.0.0: {}",
  "",
  "  vitest@4.0.0:",
  "    transitivePeerDependencies:",
  "      - supports-color",
  "",
].join("\n");

const pnpmModules = (nodeLinker: string) =>
  JSON.stringify({
    hoistedDependencies: { "b@1.0.0": { b: "private" }, "q@1.0.0": { q: "public" } },
    nodeLinker,
    skipped: ["fsevents@2.3.3"],
    virtualStoreDir: ".pnpm",
    virtualStoreDirMaxLength: 120,
  });

const pnpmFolder = (folder: string, name: string, files: Readonly<Record<string, string>>) =>
  Object.fromEntries(
    Object.entries({ "package.json": `{"name":"${name}"}`, ...files }).map(([file, text]) => [
      `node_modules/.pnpm/${folder}/node_modules/${name}/${file}`,
      text,
    ]),
  );

const runtime = { "index.js": "module.exports = 1;\n" };

/** An isolated pnpm install with `nodeLinker` in `.modules.yaml`, `lock.yaml` written last. */
const pnpmInstall = (nodeLinker = "isolated"): Readonly<Record<string, string>> => ({
  ...pnpmFolder(CSS_CALC_FOLDER, "@csstools/css-calc", runtime),
  ...pnpmFolder("@types+x@1.0.0", "@types/x", { "index.d.ts": "export {};\n" }),
  ...pnpmFolder("a@1.0.0", "a", runtime),
  ...pnpmFolder("b@1.0.0", "b", runtime),
  ...pnpmFolder("p@1.0.0_q@1.0.0", "p", runtime),
  ...pnpmFolder("pub@1.0.0", "pub", { "index.js": 'require("node:child_process");\n' }),
  ...pnpmFolder("q@1.0.0", "q", runtime),
  ...pnpmFolder("real@1.0.0", "real", runtime),
  ...pnpmFolder("tarball@1.0.0", "tarball", runtime),
  ...pnpmFolder("vitest@4.0.0", "vitest", runtime),
  "node_modules/vitest/package.json": '{"name":"vitest"}',
  "packages/lib/index.js": "export {};\n",
  "node_modules/.modules.yaml": pnpmModules(nodeLinker),
  "node_modules/.pnpm/lock.yaml": pnpmLock,
});

const vitest = [{ from: "", name: "vitest" }];

/** A pnpm case whose test file imports `imports`, over `installed`. */
const pnpmCase = (
  installed: Readonly<Record<string, string>>,
  imports: readonly { from: string; name: string; manifest?: true }[],
): KeyInput => ({
  ...over(installed),
  packages: {
    environment: { imports: vitest, builtins: [], runner: vitest },
    testFile: { imports, builtins: [] },
  },
});

export const PNPM_KEYS: readonly Case[] = [
  {
    kind: "key",
    name: "a trusted pnpm install's segment",
    why: "011-162 (R1, R2): pnpm's lock.yaml read as a graph; each lookup of design section 1",
    input: pnpmCase(pnpmInstall(), [
      { from: "node_modules/.pnpm/a@1.0.0", name: "a" },
      { from: "node_modules/.pnpm/a@1.0.0", name: "b" },
      { from: "node_modules/.pnpm/real@1.0.0", name: "b" },
      { from: "node_modules/.pnpm/real@1.0.0", name: "vitest" },
      { from: `node_modules/.pnpm/${CSS_CALC_FOLDER}`, name: "@csstools/css-calc" },
      { from: "packages/app/test", name: "a", manifest: true },
      { from: "packages/app/test", name: "alias" },
      { from: "packages/app/test", name: "lib" },
      { from: "packages/app/test", name: "p" },
      { from: "test", name: "q" },
      { from: "test", name: "absent" },
    ]),
  },
  {
    kind: "key",
    name: "a pnpm folder no snapshot names",
    why: "011-162 (R1): a closure resolved under another install keys its file whole",
    input: pnpmCase(pnpmInstall(), [{ from: "node_modules/.pnpm/a@0.9.0", name: "a" }]),
  },
  {
    kind: "key",
    name: "a pnpm package without an integrity",
    why: "011-162 (R1): a tarball's snapshot keys its file whole",
    input: pnpmCase(pnpmInstall(), [{ from: "packages/app/test", name: "tarball" }]),
  },
  {
    kind: "key",
    name: "an opaque pnpm package",
    why: "011-162 (R1): C11 case (4) scans the package's .pnpm folder",
    input: pnpmCase(pnpmInstall(), [{ from: "packages/app/test", name: "pub" }]),
  },
  {
    kind: "key",
    name: "a stale pnpm install",
    why: "011-162 (R2): an entry lock.yaml does not list keys the install by its package folders",
    input: pnpmCase({ "node_modules/extra/index.js": "module.exports = 1;\n", ...pnpmInstall() }, [
      { from: "packages/app/test", name: "a" },
    ]),
  },
  {
    kind: "key",
    name: "a hoisted pnpm install",
    why: "011-162 (R2): nodeLinker hoisted keeps the whole fingerprint",
    input: pnpmCase(pnpmInstall("hoisted"), [{ from: "packages/app/test", name: "a" }]),
  },
];
