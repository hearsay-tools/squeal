import type { Case, KeyInput } from "../../case.js";
import { GOLDEN_KEYS } from "./golden.js";

const [golden] = GOLDEN_KEYS;
if (golden?.kind !== "key") throw new Error("golden key case missing");

const over = (installed: Readonly<Record<string, string>>): KeyInput => ({
  ...golden.input,
  installed,
});

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

/**
 * The links of `pnpmLock` a lookup resolves through, as folders (review 0.1.282 B2): each name
 * an importer declares, each hoisted name and each edge beside a package folder. `fsevents` is
 * skipped and has none.
 */
const pnpmLinks = Object.fromEntries(
  [
    "node_modules/q",
    "node_modules/.pnpm/node_modules/b",
    "node_modules/.pnpm/a@1.0.0/node_modules/@types/x",
    "node_modules/.pnpm/a@1.0.0/node_modules/b",
    "node_modules/.pnpm/p@1.0.0_q@1.0.0/node_modules/q",
    ...["a", "alias", "lib", "p", "pub", "tarball"].map(
      (name) => `packages/app/node_modules/${name}`,
    ),
  ].map((path) => [`${path}/package.json`, "{}"]),
);

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
  ...pnpmLinks,
  "packages/lib/index.js": "export {};\n",
  "node_modules/.modules.yaml": pnpmModules(nodeLinker),
  "node_modules/.pnpm/lock.yaml": pnpmLock,
});

/**
 * Review 0.1.282 B2.1: `packages/app` declares `a` 1.0.0 as an optional platform package pnpm
 * skipped, so Node walks past it to the root's `a` at `version`; the key holds that copy.
 */
const skippedInstall = (version: string): Readonly<Record<string, string>> => ({
  ...pnpmFolder(`a@${version}`, "a", runtime),
  ...pnpmFolder("vitest@4.0.0", "vitest", runtime),
  "node_modules/a/package.json": "{}",
  "node_modules/vitest/package.json": '{"name":"vitest"}',
  "node_modules/.modules.yaml": JSON.stringify({
    nodeLinker: "isolated",
    skipped: ["a@1.0.0"],
    virtualStoreDir: ".pnpm",
  }),
  "node_modules/.pnpm/lock.yaml": [
    "lockfileVersion: '9.0'",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    "      a:",
    `        specifier: ^${version}`,
    `        version: ${version}`,
    "      vitest:",
    "        specifier: ^4.0.0",
    "        version: 4.0.0",
    "",
    "  packages/app:",
    "    optionalDependencies:",
    "      a:",
    "        specifier: ^1.0.0",
    "        version: 1.0.0",
    "",
    "packages:",
    "",
    "  a@1.0.0:",
    "    resolution: {integrity: sha512-a1}",
    "    os: [darwin]",
    "",
    `  a@${version}:`,
    `    resolution: {integrity: sha512-a${version}}`,
    "",
    "  vitest@4.0.0:",
    "    resolution: {integrity: sha512-vitest}",
    "",
    "snapshots:",
    "",
    "  a@1.0.0:",
    "    optional: true",
    "",
    `  a@${version}: {}`,
    "",
    "  vitest@4.0.0: {}",
    "",
  ].join("\n"),
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
    name: "a pnpm lock.yaml with its importers on their header line",
    why: "review 0.1.282 B1: a part the reader reads, written as a flow map, keeps the whole fingerprint",
    input: pnpmCase(
      {
        ...pnpmInstall(),
        "node_modules/.pnpm/lock.yaml": pnpmLock.replace(
          /importers:\n[\s\S]*?\npackages:/,
          "importers: {'.': {devDependencies: {vitest: {specifier: ^4.0.0, version: 4.0.0}}}}\n\npackages:",
        ),
      },
      [{ from: "test", name: "vitest" }],
    ),
  },
  {
    kind: "key",
    name: "a pnpm install missing a declared link",
    why: "review 0.1.282 B2: Node walks past a missing link to the root's copy, so the install is stale",
    input: pnpmCase(
      Object.fromEntries(
        Object.entries(pnpmInstall()).filter(
          ([path]) => path !== "packages/app/node_modules/a/package.json",
        ),
      ),
      [{ from: "packages/app/test", name: "a" }],
    ),
  },
  ...["2.0.0", "3.0.0"].map(
    (version): Case => ({
      kind: "key",
      name: `a workspace's skipped optional package, past which Node loads the root's a@${version}`,
      why: "review 0.1.282 B2.1: the key holds the copy Node walks on to, so the two installs key apart",
      input: pnpmCase(skippedInstall(version), [{ from: "packages/app/test", name: "a" }]),
    }),
  ),
  {
    kind: "key",
    name: "a hoisted pnpm install",
    why: "011-162 (R2): nodeLinker hoisted keeps the whole fingerprint",
    input: pnpmCase(pnpmInstall("hoisted"), [{ from: "packages/app/test", name: "a" }]),
  },
];
