import { describe, expect, it } from "vitest";
import { failures } from "./compare.js";
import { comparisons, edited, read, SLOW } from "./self-test.js";
import { ROOT } from "./trees.js";

/*
 * Risk 9 of task 011-37 (design section 6): a package an entry imports, or
 * esbuild, moved since the last release. Each test is of the comparison's
 * decision that the last release's lock must be installed, not of the
 * install itself: a lock entry is overlaid, and the installer is a stub.
 */

const { compare, release } = comparisons();

/** `package-lock.json` with `field` of the entry at `location` set to `value`. */
function lockEntry(location: string, field: string, value: string) {
  const path = "package-lock.json";
  const lock = JSON.parse(read(path)) as { packages: Record<string, Record<string, unknown>> };
  expect(lock.packages[location], location).toBeDefined();
  lock.packages[location] = { ...lock.packages[location], [field]: value };
  return { [path]: `${JSON.stringify(lock, null, 2)}\n` };
}

const fired = (result: Awaited<ReturnType<typeof compare>>) =>
  result.alarms.filter((a) => a.fired).map((a) => a.component.name);

describe("a moved package (risk 9)", SLOW, () => {
  it("reports that the last release's lock must be installed, a transitive package included", async () => {
    for (const overlay of [
      lockEntry("node_modules/enhanced-resolve", "version", "5.99.0"),
      lockEntry("node_modules/tapable", "integrity", "sha512-x"),
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
      lockEntry("node_modules/esbuild", "version", "0.99.0"),
      [],
      ROOT,
      null,
    );
    expect(fired(result)).toEqual(["global", "vitest", "node:test", "pytest", "recorder"]);
  });

  it("installs the last release's lock once, then compares each side at its own packages", async () => {
    const installs: string[] = [];
    const result = await compare(
      lockEntry("node_modules/enhanced-resolve", "version", "5.99.0"),
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
      lockEntry("node_modules/@biomejs/biome", "version", "9.0.0"),
      [],
      ROOT,
      null,
    );
    expect(tool.fired).toBe(false);
    const version = read("package.json").match(/"version": "[^"]+"/)?.[0] ?? '"version"';
    const bumped = await compare(
      {
        ...edited("package.json", version, '"version": "9.9.9"'),
        ...lockEntry("", "version", "9.9.9"),
      },
      [],
      ROOT,
      null,
    );
    expect(bumped.fired).toBe(false);
  });
});
