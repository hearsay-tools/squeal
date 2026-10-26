import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { failures } from "./compare.js";
import { esbuildOf, installLock } from "./lock.js";
import { comparisons, edited, read, SLOW } from "./self-test.js";
import { dependencyLines, extractTree, type Overlay, ROOT } from "./trees.js";

/*
 * Risk 9 of task 011-37 (design section 6): a package an entry imports, or
 * esbuild, moved since the last release. Each test is of the comparison's
 * decision that the last release's lock must be installed, not of the
 * install itself: a lock entry is overlaid, and the installer is a stub.
 *
 * Row 017-11: the lock is npm's at releases before pnpm's, and pnpm's since,
 * so its lines must agree across the two formats and still move for every
 * version, integrity, loaded copy and number of copies that moves.
 */

const { compare, release } = comparisons();

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** pnpm's lock `text` with `name@from` renamed `name@to`: keys, snapshot ids, edges and importers. */
function renamed(text: string, name: string, from: string, to: string): string {
  const [n, f] = [literal(name), literal(from)];
  const replaced = text
    .replace(new RegExp(`(?<=^|[\\s'(])${n}@${f}(?=[:'()\\s])`, "gm"), `${name}@${to}`)
    .replace(new RegExp(`^(\\s+'?${n}'?: )${f}$`, "gm"), `$1${to}`)
    .replace(
      new RegExp(`^(\\s+'?${n}'?:\\n\\s+specifier: .*\\n\\s+version: )${f}$`, "gm"),
      `$1${to}`,
    );
  expect(replaced, `${name}@${from} is not in the lock`).not.toBe(text);
  return replaced;
}

/** pnpm's lock `text` with the integrity of the package `id` replaced. */
function reintegrity(text: string, id: string, sri: string): string {
  const entry = new RegExp(`^(  '?${literal(id)}'?:\\n    resolution: \\{integrity: )[^}]+`, "m");
  expect(text, `${id} is not in the lock`).toMatch(entry);
  return text.replace(entry, `$1${sri}`);
}

/** This checkout's `pnpm-lock.yaml`, changed by `change`. */
const lock = (change: (text: string) => string): Overlay => {
  const path = "pnpm-lock.yaml";
  return { [path]: change(read(path)) };
};

const fired = (result: Awaited<ReturnType<typeof compare>>) =>
  result.alarms.filter((a) => a.fired).map((a) => a.component.name);

describe("a moved package (risk 9)", SLOW, () => {
  it("reports that the last release's lock must be installed, a transitive package included", async () => {
    for (const overlay of [
      lock((text) => renamed(text, "enhanced-resolve", "5.26.0", "5.99.0")),
      lock((text) => renamed(text, "tapable", "2.3.3", "2.99.0")),
      lock((text) => reintegrity(text, "tapable@2.3.3", "sha512-x")),
    ]) {
      const result = await compare(overlay, [], ROOT, null);
      expect(fired(result)).toEqual(["node:test"]);
      expect(result.installed).toBe(false);
      expect(failures(result, release())).toEqual([
        expect.stringMatching(
          /^NODE_TEST_ADAPTER_VERSION .*: the packages its entries import, or esbuild, moved since .* the last release must be bundled from its own lock/,
        ),
      ]);
    }
  });

  it("fires every component when the bundler moved", async () => {
    const result = await compare(
      lock((text) => renamed(text, "esbuild", "0.28.2", "0.99.0")),
      [],
      ROOT,
      null,
    );
    expect(fired(result)).toEqual(["global", "vitest", "node:test", "pytest", "recorder"]);
  });

  it("installs the last release's lock once, then compares each side at its own packages", async () => {
    const installs: string[] = [];
    const result = await compare(
      lock((text) => renamed(text, "enhanced-resolve", "5.26.0", "5.99.0")),
      [],
      ROOT,
      (tree) => installs.push(tree),
    );
    expect(installs).toEqual([ROOT]);
    expect(result.installed).toBe(true);
    expect(failures(result, release())).toEqual([]);
  });

  it("fires none for a tool's lock entry, nor for the release's own version", async () => {
    const tool = await compare(
      lock((text) => renamed(text, "@biomejs/biome", "2.5.15", "9.0.0")),
      [],
      ROOT,
      null,
    );
    expect(tool.fired).toBe(false);
    const version = read("package.json").match(/"version": "[^"]+"/)?.[0] ?? '"version"';
    const bumped = await compare(
      edited("package.json", version, '"version": "9.9.9"'),
      [],
      ROOT,
      null,
    );
    expect(bumped.fired).toBe(false);
  });
});

/*
 * The lines themselves, on one package set locked by npm and by pnpm
 * (`test/fixtures/keys/locks`): npm nests `ms` 2.0.0 under `debug`.
 */
const LOCKS = join(ROOT, "test/fixtures/keys/locks");
const NPM = join(LOCKS, "npm");
const PNPM = join(LOCKS, "pnpm");
const ROOTS = ["debug", "ms", "ms1", "ts-api-utils"];
const npmText = readFileSync(join(NPM, "package-lock.json"), "utf8");
const pnpmText = readFileSync(join(PNPM, "pnpm-lock.yaml"), "utf8");

/** npm's fixture lock with `change` applied to its `packages`. */
function npm(change: (packages: Record<string, Record<string, unknown>>) => void): Overlay {
  const parsed = JSON.parse(npmText) as { packages: Record<string, Record<string, unknown>> };
  change(parsed.packages);
  return { "package-lock.json": JSON.stringify(parsed) };
}

const pnpm = (change: (text: string) => string): Overlay => ({
  "pnpm-lock.yaml": change(pnpmText),
});

/** Each line's own `name@version#integrity`, the copies and loads left out. */
const identities = (lines: string[]) => lines.map((line) => line.split(" ")[0] ?? "").sort();

describe("the dependency lines (017-11)", () => {
  const npmLines = dependencyLines(NPM, ROOTS);
  const pnpmLines = dependencyLines(PNPM, ROOTS);

  it("are one list for one package set in npm's lock and pnpm's", () => {
    expect(pnpmLines).toEqual(npmLines);
    expect(npmLines).toContain(
      `debug@2.6.9#${/"integrity": "(sha512-bC7[^"]+)"/.exec(npmText)?.[1]} ms=ms@2.0.0`,
    );
    expect(identities(npmLines).filter((id) => id.startsWith("ms@"))).toHaveLength(3);
  });

  it("move for a transitive package's version or integrity, in either lock", () => {
    const moved = [
      dependencyLines(
        PNPM,
        ROOTS,
        pnpm((text) => renamed(text, "ms", "2.0.0", "2.0.1")),
      ),
      dependencyLines(
        PNPM,
        ROOTS,
        pnpm((text) => reintegrity(text, "ms@2.0.0", "sha512-x")),
      ),
      dependencyLines(
        NPM,
        ROOTS,
        npm((p) =>
          Object.assign(p["node_modules/debug/node_modules/ms"] ?? {}, { version: "2.0.1" }),
        ),
      ),
      dependencyLines(
        NPM,
        ROOTS,
        npm((p) =>
          Object.assign(p["node_modules/debug/node_modules/ms"] ?? {}, { integrity: "sha512-x" }),
        ),
      ),
    ];
    for (const lines of moved) expect(lines).not.toEqual(npmLines);
  });

  it("move when a package loads another copy, though the same packages are locked", () => {
    // debug now loads ms 2.1.3, and the root ms 2.0.0: the same three ms entries.
    const swapped = [
      dependencyLines(
        PNPM,
        ROOTS,
        pnpm((text) =>
          text
            .replace(
              "      ms:\n        specifier: 2.1.3\n        version: 2.1.3",
              "      ms:\n        specifier: 2.1.3\n        version: 2.0.0",
            )
            .replace(
              "  debug@2.6.9:\n    dependencies:\n      ms: 2.0.0",
              "  debug@2.6.9:\n    dependencies:\n      ms: 2.1.3",
            ),
        ),
      ),
      dependencyLines(
        NPM,
        ROOTS,
        npm((p) => {
          [p["node_modules/ms"], p["node_modules/debug/node_modules/ms"]] = [
            p["node_modules/debug/node_modules/ms"] ?? {},
            p["node_modules/ms"] ?? {},
          ];
        }),
      ),
    ];
    for (const lines of swapped) {
      expect(identities(lines)).toEqual(identities(npmLines));
      expect(lines).not.toEqual(npmLines);
      expect(lines.find((line) => line.startsWith("debug@"))).toMatch(/ ms=ms@2\.1\.3$/);
    }
    expect(swapped[0]).toEqual(swapped[1]);
  });

  it("tell two copies of one version apart by what they load, and which one each loader loads", () => {
    // Two snapshots of debug 2.6.9: X loads ms 2.0.0, Y ms 2.1.3. ts-api-utils, ms 1.0.0 and the
    // root each load one; each arrangement locks the same packages and the same two copies.
    const [x, y] = ["2.6.9", "2.6.9(ms@1.0.0)"];
    const arranged = (tsApiUtils: string, ms1: string, root: string) =>
      dependencyLines(
        PNPM,
        ROOTS,
        pnpm((text) =>
          text
            .replace(
              "  debug@2.6.9:\n    dependencies:\n      ms: 2.0.0\n",
              "$&\n  debug@2.6.9(ms@1.0.0):\n    dependencies:\n      ms: 2.1.3\n",
            )
            .replace(
              "  ts-api-utils@2.5.0(typescript@6.0.3):\n    dependencies:\n",
              `$&      debug: ${tsApiUtils}\n`,
            )
            .replace("  ms@1.0.0: {}\n", `  ms@1.0.0:\n    dependencies:\n      debug: ${ms1}\n`)
            .replace(
              "      debug:\n        specifier: 2.6.9\n        version: 2.6.9\n",
              `      debug:\n        specifier: 2.6.9\n        version: ${root}\n`,
            ),
        ),
      );
    const base = arranged(x, y, x);
    expect(base.filter((line) => line.startsWith("debug@"))).toEqual([
      expect.stringMatching(/^debug@2\.6\.9#\S+~0 ms=ms@2\.\d\.\d$/),
      expect.stringMatching(/^debug@2\.6\.9#\S+~1 ms=ms@2\.\d\.\d$/),
    ]);
    // The two loaders swap copies; then the root loads the other one.
    expect(arranged(y, x, x)).not.toEqual(base);
    expect(arranged(x, y, y)).not.toEqual(base);
  });

  it("move for a copy more of one package, which npm's lock can hold", () => {
    const once = dependencyLines(
      NPM,
      ROOTS,
      npm((p) => delete p["node_modules/debug/node_modules/ms"]),
    );
    const twice = dependencyLines(
      NPM,
      ROOTS,
      npm((p) => {
        p["node_modules/debug/node_modules/ms"] = { ...p["node_modules/ms"] };
      }),
    );
    expect(once.find((line) => line.startsWith("ms@2.1.3"))).not.toContain(" x");
    expect(twice.find((line) => line.startsWith("ms@2.1.3"))).toMatch(/^ms@2\.1\.3#\S+ x2$/);
  });

  it("throw for a lock they cannot read, never an empty list", () => {
    const throws: [() => unknown, RegExp][] = [
      [() => dependencyLines(LOCKS, ROOTS), /0 of package-lock\.json and pnpm-lock\.yaml/],
      [
        () => dependencyLines(NPM, ROOTS, { "pnpm-lock.yaml": pnpmText }),
        /2 of package-lock\.json/,
      ],
      [
        () => dependencyLines(NPM, ROOTS, { "package-lock.json": '{"lockfileVersion":1}' }),
        /lockfileVersion 1; it reads 2 and 3/,
      ],
      [
        () =>
          dependencyLines(
            PNPM,
            ROOTS,
            pnpm((text) => text.replaceAll("lockfileVersion: '9.0'", "lockfileVersion: '6.0'")),
          ),
        /not one pnpm lockfile document/,
      ],
      [
        () =>
          dependencyLines(
            NPM,
            ROOTS,
            npm((p) => delete p["node_modules/debug"]?.integrity),
          ),
        /node_modules\/debug records no version or no integrity/,
      ],
      [
        () =>
          dependencyLines(
            PNPM,
            ROOTS,
            pnpm((text) => text.replace("  ms@2.0.0: {}\n", "")),
          ),
        /ms \(from "debug@2\.6\.9"\) is ms@2\.0\.0, which has no snapshot/,
      ],
      [() => dependencyLines(PNPM, [...ROOTS, "absent"]), /absent \(from ""\) not found/],
    ];
    for (const [lines, error] of throws) expect(lines).toThrow(error);
  });
});

describe("a pnpm tree's extraction (017-11)", () => {
  const work = mkdtempSync(join(tmpdir(), "squeal-validity-extract-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));

  it("takes the lock, the workspace file and each workspace's manifest a frozen install reads", () => {
    extractTree("HEAD", join(work, "head"));
    const has = (path: string) => existsSync(join(work, "head", path));
    expect(
      ["pnpm-lock.yaml", "pnpm-workspace.yaml", "test/fixtures/lint/toolchain/package.json"].filter(
        has,
      ),
    ).toHaveLength(3);
    expect(has("package-lock.json")).toBe(false);
  });

  it("installs with its scripts off, and the esbuild it installed builds", SLOW, async () => {
    const tree = join(work, "installed");
    extractTree("HEAD", tree);
    installLock(tree);
    writeFileSync(join(tree, "entry.ts"), "export const one: number = 1;\n");
    const build = await esbuildOf(tree);
    const built = await build({ entryPoints: [join(tree, "entry.ts")], write: false });
    expect(built.outputFiles[0]?.text).toContain("one = 1");
  });
});
