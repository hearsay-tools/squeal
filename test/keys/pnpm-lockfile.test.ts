import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installedDependencies } from "../../src/core/keys/index.js";
import { withoutLinkedSpecifiers } from "../../src/core/keys/pnpm-lockfile.js";
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
