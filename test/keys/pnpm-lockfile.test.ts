import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installedDependencies } from "../../src/core/keys/index.js";
import {
  pnpmFolderName,
  readPnpmLockfile,
  withoutLinkedSpecifiers,
} from "../../src/core/keys/pnpm-lockfile.js";
import { tempDir, writeFile } from "../hash/git-repo.js";

// Task 011-85, R3 (011 C11): pnpm's installed `lock.yaml` records the range each dependent asks
// for a linked workspace package, which a release rewrites (cezar's 8 releases from 2026-09-22 to
// 2026-10-08). The fingerprint leaves that range out and keeps the link's target.

interface Fields {
  /** The range the root asks for its linked workspace package. */
  readonly linked?: string;
  readonly target?: string;
  /** The range and the resolved version of a registry dependency. */
  readonly range?: string;
  readonly version?: string;
}

const lockfile = ({
  linked = "^0.16.0",
  target = "../contract",
  range = "^3.23.0",
  version = "3.23.8",
}: Fields = {}) => `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      '@open-mercato/cezar-contract':
        specifier: ${linked}
        version: link:${target}
      zod:
        specifier: ${range}
        version: ${version}

  contract:
    dependencies:
      zod:
        specifier: ${range}
        version: ${version}

packages:

  zod@${version}:
    resolution: {integrity: sha512-zod-${version}}

snapshots:

  zod@${version}: {}
`;

describe("the installed-dependency fingerprint of pnpm's lock.yaml (011-85, R3)", () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir();
  });
  afterEach(() => dir.cleanup());

  const fingerprint = async (fields: Fields = {}) => {
    writeFile(dir.path, "node_modules/.pnpm/lock.yaml", lockfile(fields));
    return (await installedDependencies(dir.path, dir.path)).fingerprint;
  };

  it("keeps it across a release that rewrites a linked dependency's range", async () => {
    expect(await fingerprint({ linked: "^0.17.0" })).toBe(await fingerprint());
  });

  it("moves it for a registry range, a link's target or a registry version", async () => {
    const all = [
      await fingerprint(),
      await fingerprint({ range: "^3.24.0" }),
      await fingerprint({ target: "../contract-next" }),
      await fingerprint({ version: "3.23.9" }),
    ];
    expect(new Set(all).size).toBe(4);
  });
});

describe("withoutLinkedSpecifiers", () => {
  it("leaves a file with no linked dependency as written", () => {
    const registry =
      "importers:\n\n  .:\n    dependencies:\n      zod:\n        specifier: ^3.23.0\n        version: 3.23.8\n";
    for (const text of ["lockfileVersion: '9.0'\n", registry]) {
      expect(withoutLinkedSpecifiers(text)).toBe(text);
    }
  });

  it("drops only the specifier line right above a link at its own indent", () => {
    const text = lockfile();
    expect(withoutLinkedSpecifiers(text)).toBe(text.replace("        specifier: ^0.16.0\n", ""));
    const deeper = "      a:\n        specifier: ^1.0.0\n          version: link:../a\n";
    expect(withoutLinkedSpecifiers(deeper)).toBe(deeper);
  });
});

// Task 011-162 R1 (011 C11): a line reader of the three parts of pnpm's written `lock.yaml` a key
// reads, and pnpm's rule for the `.pnpm` folder of a snapshot. The text below keeps the layout of
// cezar's installed file (pnpm 12.11.2): every line kind it holds, read or skipped.
const WRITTEN = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    devDependencies:
      vitest:
        specifier: ^4.1.10
        version: 4.1.10(@types/node@24.19.1)
    dependenciesMeta:
      lib:
        injected: false

  packages/app:
    dependencies:
      '@hono/node-server':
        specifier: ^1.13.0
        version: 1.19.14(hono@4.12.29)
      lib:
        specifier: workspace:*
        version: link:../lib
    optionalDependencies:
      fsevents:
        specifier: ^2.3.3
        version: 2.3.3

packages:

  '@hono/node-server@1.19.14':
    resolution: {integrity: sha512-node-server==}
    engines: {node: '>=18.14.1'}
    peerDependencies:
      hono: ^4
    peerDependenciesMeta:
      hono:
        optional: true

  '@types/node@24.19.1':
    resolution: {integrity: sha512-types/node+==}

  fsevents@2.3.3:
    resolution: {integrity: sha512-fsevents==}
    engines: {node: ^8.16.0 || ^10.6.0 || >=11.0.0}
    os: [darwin]
    bundledDependencies:
      - '@emnapi/core'
    deprecated: 'Upgrade: see https://example.com'

  hono@4.12.29:
    resolution: {integrity: sha512-hono==}
    hasBin: true

  string-width@4.2.3:
    resolution: {tarball: https://example.com/string-width.tgz}

  vitest@4.1.10:
    resolution: {integrity: sha512-vitest==}

snapshots:

  '@hono/node-server@1.19.14(hono@4.12.29)':
    dependencies:
      hono: 4.12.29

  '@types/node@24.19.1': {}

  fsevents@2.3.3:
    optional: true

  hono@4.12.29: {}

  string-width@4.2.3: {}

  vitest@4.1.10(@types/node@24.19.1):
    dependencies:
      string-width-cjs: string-width@4.2.3
    optionalDependencies:
      '@types/node': 24.19.1
    transitivePeerDependencies:
      - '@types/react'
      - supports-color
`;

describe("readPnpmLockfile (011-162, R1)", () => {
  it("reads each importer's declared names, each package's integrity and each snapshot's edges", () => {
    expect(readPnpmLockfile(WRITTEN)).toEqual({
      importers: new Map([
        [".", new Map([["vitest", "4.1.10(@types/node@24.19.1)"]])],
        [
          "packages/app",
          new Map([
            ["@hono/node-server", "1.19.14(hono@4.12.29)"],
            ["lib", "link:../lib"],
            ["fsevents", "2.3.3"],
          ]),
        ],
      ]),
      integrity: new Map([
        ["@hono/node-server@1.19.14", "sha512-node-server=="],
        ["@types/node@24.19.1", "sha512-types/node+=="],
        ["fsevents@2.3.3", "sha512-fsevents=="],
        ["hono@4.12.29", "sha512-hono=="],
        ["vitest@4.1.10", "sha512-vitest=="],
      ]),
      snapshots: new Map([
        ["@hono/node-server@1.19.14(hono@4.12.29)", new Map([["hono", "4.12.29"]])],
        ["@types/node@24.19.1", new Map()],
        ["fsevents@2.3.3", new Map()],
        ["hono@4.12.29", new Map()],
        ["string-width@4.2.3", new Map()],
        [
          "vitest@4.1.10(@types/node@24.19.1)",
          new Map([
            ["string-width-cjs", "string-width@4.2.3"],
            ["@types/node", "24.19.1"],
          ]),
        ],
      ]),
    });
  });

  it("returns null for another lockfile format, a second document or a line it does not know", () => {
    const unknown = [
      WRITTEN.replace("lockfileVersion: '9.0'", "lockfileVersion: '6.0'"),
      WRITTEN.replace("lockfileVersion: '9.0'\n", ""),
      `${WRITTEN}---\n${WRITTEN}`,
      WRITTEN.replace("      hono: 4.12.29\n", '      "hono": 4.12.29\n'),
      WRITTEN.replace("      hono: 4.12.29\n", "      hono:\n        version: 4.12.29\n"),
      WRITTEN.replace("      hono: 4.12.29\n", "      hono: 4.12.29\n        extra: 1\n"),
      WRITTEN.replace("      hono: 4.12.29\n", "      - hono\n"),
      WRITTEN.replace(
        "    dependencies:\n      hono: 4.12.29\n",
        "    dependencies: {hono: 4.12.29}\n",
      ),
      WRITTEN.replace("  hono@4.12.29: {}\n", "  hono@4.12.29: {optional: true}\n"),
      WRITTEN.replace("        version: link:../lib\n", ""),
      WRITTEN.replace("      vitest:\n", "\tvitest:\n"),
    ];
    for (const text of unknown) expect(readPnpmLockfile(text)).toBeNull();
  });

  // Review 0.1.282 B1: a part the reader reads, written on its header line, was skipped unread,
  // so a graph with no importers stood for the install. Every key the reader passes over is now
  // one pnpm writes (`convertToLockfileFile` of pnpm 10.32.0; cezar's file under pnpm 12.11.2).
  it("returns null for a part it reads written on its header line, or a key pnpm does not write", () => {
    const unknown = [
      WRITTEN.replace(
        /importers:\n[\s\S]*?\npackages:/,
        "importers: {'.': {devDependencies: {vitest: {specifier: ^4.1.10, version: 4.1.10}}}}\n\npackages:",
      ),
      WRITTEN.replace(/packages:\n[\s\S]*?\nsnapshots:/, "packages: {}\n\nsnapshots:"),
      WRITTEN.replace(/snapshots:\n[\s\S]*$/, "snapshots: {}\n"),
      WRITTEN.replace(/\n {2}\.:\n[\s\S]*?\n\n {2}packages\/app:/, "\n  packages/app:"),
      `${WRITTEN}\nfuture: true\n`,
      WRITTEN.replace("    dependenciesMeta:\n", "    future:\n"),
      WRITTEN.replace(
        "        specifier: ^4.1.10\n",
        "        specifier: ^4.1.10\n        future: 1\n",
      ),
      WRITTEN.replace("    hasBin: true\n", "    future: true\n"),
      WRITTEN.replace(
        "    resolution: {integrity: sha512-hono==}\n",
        "    resolution:\n      integrity: sha512-hono==\n",
      ),
      WRITTEN.replace(
        "  hono@4.12.29:\n    resolution: {integrity: sha512-hono==}\n    hasBin: true\n",
        "  hono@4.12.29: {resolution: {integrity: sha512-hono==}}\n",
      ),
      WRITTEN.replace(
        "  fsevents@2.3.3:\n    optional: true\n",
        "  fsevents@2.3.3:\n    future: true\n",
      ),
    ];
    for (const text of unknown) expect(readPnpmLockfile(text)).toBeNull();
    const metadata = WRITTEN.replace(
      "settings:",
      [
        "overrides:\n  hono: 4.12.29\n",
        "patchedDependencies:\n  hono:\n    hash: 0f3c\n    path: patches/hono.patch\n",
        "pnpmfileChecksum: sha256-pnpmfile\npackageExtensionsChecksum: sha256-extensions\n",
        "ignoredOptionalDependencies:\n  - fsevents\n",
        "catalogs:\n  default:\n    hono:\n      specifier: ^4\n      version: 4.12.29\n",
        "settings:",
      ].join("\n"),
    )
      .replace("        version: 2.3.3\n", "        version: 2.3.3\n    publishDirectory: dist\n")
      .replace("    os: [darwin]\n", "    os: [darwin]\n    cpu: [arm64]\n    libc: [glibc]\n")
      .replace(
        "    resolution: {tarball: https://example.com/string-width.tgz}\n",
        "    resolution: {tarball: https://example.com/string-width.tgz}\n    name: string-width\n    version: 4.2.3\n",
      )
      .replace(
        "  string-width@4.2.3: {}\n",
        "  string-width@4.2.3:\n    id: string-width@https://example.com/string-width.tgz\n",
      )
      .concat("\ntime:\n  hono@4.12.29: '2026-01-01T00:00:00.000Z'\n");
    expect(readPnpmLockfile(metadata)).toEqual(readPnpmLockfile(WRITTEN));
  });
});

describe("pnpmFolderName (011-162, R1)", () => {
  it("names a cezar folder pnpm 12.11.2 cut and hashed, and a patched one", () => {
    const cases = [
      ["hono@4.12.29", "hono@4.12.29"],
      ["@hono/node-server@1.19.14(hono@4.12.29)", "@hono+node-server@1.19.14_hono@4.12.29"],
      [
        "@csstools/css-calc@3.2.1(@csstools/css-parser-algorithms@4.0.0(@csstools/css-tokenizer@4.0.0))(@csstools/css-tokenizer@4.0.0)",
        "@csstools+css-calc@3.2.1_@csstools+css-parser-algorithms@4.0.0_@csstools+css-tokenizer@_3b33f237655dfa7a35d4b0433ee15cf1",
      ],
      [
        "@radix-ui/react-arrow@1.1.11(@types/react-dom@19.2.3(@types/react@19.2.17))(@types/react@19.2.17)(react-dom@19.2.7(react@19.2.7))(react@19.2.7)",
        "@radix-ui+react-arrow@1.1.11_@types+react-dom@19.2.3_@types+react@19.2.17__@types+react_b508d5a1dc0bf609ea641fa79482cab2",
      ],
      ["hono@4.12.29(patch_hash=0f3c)", "hono@4.12.29_patch_hash=0f3c"],
      [
        "@hono/node-server@1.19.14(hono@4.12.29(patch_hash=0f3c))",
        "@hono+node-server@1.19.14_hono@4.12.29_patch_hash=0f3c_",
      ],
    ] as const;
    for (const [id, folder] of cases) expect(pnpmFolderName(id, 120)).toBe(folder);
  });
});
