import { describe, expect, it } from "vitest";
import { Keyer } from "../../../src/core/lint/pass/keyer.js";
import { createLintKeyer, type KeyBasis, lintKey } from "../../../src/core/lint/pass/keys.js";
import type { LintFileInputs, LintSnapshot } from "../../../src/core/lint/pass/provider.js";
import { lintScope, readProgram } from "../../../src/core/lint/pass/records.js";
import { rekey } from "../../../src/core/lint/pass/rekey.js";
import type { LintSourceFile } from "../../../src/core/lint/pass/types.js";
import type { RelativePath } from "../../../src/core/types/common.js";
import type { FileHash } from "../../../src/core/types/keys.js";
import { LINT_ON } from "../helpers.js";
import { FakeProvider, lintPass, lintTree, outcomes, storeOf } from "./helpers.js";

/* Row 017-36 (issue #274 F3.2, F3.4 to F3.6): the keying's speed keeps its keys and records. */

const hash = (path: string) => `h-${path}` as FileHash;

/** A basis with configs and closure files spread over the sort order. */
function basisOf(packages: string[] = []): KeyBasis {
  const snapshot: LintSnapshot = {
    declaration: {
      tool: "eslint",
      toolVersion: "9.30.0",
      providerVersion: 1,
      configFiles: ["eslint.config.js", "pkg/eslint.config.js"],
    },
    closure: ["eslint.config.js", "lib/b.js", "lib/x.js", "m/gone.js", "zeta/last.js"],
    packages,
    program: [],
    env: { ZED: "1", ALPHA: "2" },
  };
  return { snapshot, installed: "install-1", nodeMajor: 24 };
}

/** Every path has a blob except `m/gone.js` and `gone.js`. */
const blobOf = (path: RelativePath) => (path.endsWith("gone.js") ? null : hash(path));

/** Paths before, between, after and equal to the config and closure paths. */
const PATHS = [
  "a.js",
  "eslint.config.js",
  "lib/a.js",
  "lib/x.js",
  "lib/y.js",
  "m/gone.js",
  "n.js",
  "pkg/eslint.config.js",
  "pkg/z.js",
  "zeta/last.js",
  "zz.js",
  "~after.js",
  "Upper.js",
  "gone.js",
];

describe("the keys computed once per Keyer (issue #274 F3.4)", () => {
  for (const packages of [[], ["eslint-plugin-x"]]) {
    it(`match lintKey byte for byte at every sort position (packages: ${packages.length})`, () => {
      const basis = basisOf(packages);
      const keyOf = createLintKeyer(basis, blobOf);
      const configs = ['{"rules":{}}', '{"rules":{"semi":"error"}}'];
      for (const [i, path] of PATHS.entries()) {
        for (const wholeProgram of [false, true]) {
          // Shared and distinct configs: every path meets both, in turn.
          for (const config of [configs[i % 2] as string, configs[(i + 1) % 2] as string]) {
            const inputs: LintFileInputs = { config, wholeProgram };
            const segment = wholeProgram ? "seg-1" : "";
            expect(keyOf(path, inputs, segment), `${path} ${wholeProgram}`).toBe(
              lintKey(path, inputs, basis, blobOf, segment),
            );
          }
        }
      }
    });
  }

  it("Keyer.keys gives lintKey's keys, whole-program files and a listing read between", async () => {
    const provider = new FakeProvider();
    provider.wholeProgram.add("lib/y.js");
    provider.wholeProgram.add("zz.js");
    const files: LintSourceFile[] = PATHS.filter((p) => blobOf(p) !== null).map((path) => ({
      path,
      hash: hash(path),
    }));
    const source = {
      file: (path: RelativePath) => files.find((f) => f.path === path) ?? null,
      files: () => files,
    };
    const basis = basisOf();
    const keyer = new Keyer(basis, provider, source, { blobOf: () => undefined }, new Set());
    const keys = await keyer.keys(PATHS);
    expect(keys.size).toBeGreaterThan(8);
    for (const [path, keyed] of keys) {
      const inputs = (await provider.inputs([path])).get(path) as LintFileInputs;
      const segment = inputs.wholeProgram ? keyer.segment : "";
      expect(keyed.key, path).toBe(lintKey(path, inputs, basis, keyer.inputBlobOf, segment));
      expect(keyed.wholeProgram).toBe(inputs.wholeProgram);
    }
  });
});

/** Counts the event loop's turns while `work` runs. */
async function turnsDuring<T>(work: () => Promise<T>): Promise<{ result: T; turns: number }> {
  let turns = 0;
  let done = false;
  const tick = () => {
    if (done) return;
    turns++;
    setImmediate(tick);
  };
  setImmediate(tick);
  const result = await work();
  done = true;
  return { result, turns };
}

describe("the keying yields to the event loop (issue #274 F3.5)", () => {
  const MANY = 700;
  const many = Array.from({ length: MANY }, (_, i) => `src/f${String(i).padStart(4, "0")}.js`);

  it("Keyer.keys lets the event loop run every 256 files", async () => {
    const files = many.map((path) => ({ path, hash: hash(path) }));
    const index = new Map(files.map((f) => [f.path, f]));
    const source = { file: (p: RelativePath) => index.get(p) ?? null, files: () => files };
    const keyer = new Keyer(
      basisOf(),
      new FakeProvider(),
      source,
      { blobOf: () => undefined },
      new Set(),
    );
    const { result, turns } = await turnsDuring(() => keyer.keys(many));
    expect(result.size).toBe(MANY);
    expect(turns).toBeGreaterThanOrEqual(2);
  });

  it("a keying of 700 files yields in keys and judgeAll, and writes in one transaction", async () => {
    const tree = lintTree();
    for (const path of many) tree.write(path, "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    await provider.open();
    const snapshot = (await provider.refresh("none")) as LintSnapshot;
    const store = storeOf(tree);
    let transactions = 0;
    const transaction = store.transaction.bind(store);
    store.transaction = ((work: () => unknown) => {
      transactions++;
      return transaction(work as () => void);
    }) as typeof store.transaction;
    let turns = 0;
    let keying = false;
    const tick = () => {
      if (!keying) return;
      turns++;
      setImmediate(tick);
    };
    const onKeying = (on: boolean) => {
      keying = on;
      if (on) setImmediate(tick);
    };
    const basis = { snapshot, installed: "install-1", nodeMajor: 24 };
    const keyer = new Keyer(basis, provider, tree.source, { blobOf: () => undefined }, new Set());
    const ctx = {
      worktreeId: tree.id,
      tool: "eslint" as const,
      store,
      source: tree.source,
      lint: LINT_ON.lint,
      now: () => 1_000 as never,
      recorded: () => {},
      readByLint: new Set<RelativePath>(),
      onKeying,
    };
    const keyed = await rekey(ctx, keyer, tree.source.latestRevision());
    expect(keyed?.keyed).toBe(MANY);
    expect(transactions).toBe(1);
    // Two yields in `keys` (256, 512) and two in `judgeAll`.
    expect(turns).toBeGreaterThanOrEqual(4);
    expect(store.states.list(tree.id, { tool: "eslint" })).toHaveLength(MANY);
  });
});

/** A fake whose `inputs` calls are counted, and that tells whether `onKeying` was on at each. */
class WatchedProvider extends FakeProvider {
  readonly inputCalls: string[][] = [];
  readonly keyingAtInputs: boolean[] = [];
  keying = false;

  override async inputs(paths: readonly string[]) {
    this.inputCalls.push([...paths]);
    this.keyingAtInputs.push(this.keying);
    await new Promise<void>((done) => setTimeout(done, 5));
    this.keyingAtInputs.push(this.keying);
    return super.inputs(paths);
  }
}

describe("the keying asks once and is told around its own work (issue #274 F3.2, F3.6)", () => {
  it("a narrowed lint.include makes one inputs call, learns extensions and checks only selected files", async () => {
    const tree = lintTree()
      .write("src/a.js", "ok\n")
      .write("src/b.md", "# doc\n")
      .write("docs/c.md", "# doc\n")
      .write("docs/d.txt", "text\n")
      .write("other/e.js", "ok\n");
    tree.revise();
    const provider = new WatchedProvider();
    provider.extensions.add(".md");
    const policy = { ...LINT_ON, lint: { ...LINT_ON.lint, include: ["src/**"] } };
    const { pass, errors } = lintPass(tree, provider, { policy: () => policy });
    pass.nudge();
    await pass.idle();
    await pass.close();
    expect(errors).toEqual([]);
    expect(provider.inputCalls).toEqual([["src/a.js", "src/b.md", "docs/c.md", "docs/d.txt"]]);
    const store = storeOf(tree);
    expect(outcomes(store, tree)).toEqual({ "src/a.js": "pass", "src/b.md": "pass" });
    // `.md` is learned from the selected file and from the unselected one alike.
    expect(readProgram(store.meta, lintScope(tree.id, "eslint")).extensions).toEqual([".md"]);
  });

  it("onKeying is false while the provider's inputs are pending and true during the keying", async () => {
    const tree = lintTree().write("src/a.js", "ok\n").write("src/b.js", "ok\n");
    tree.revise();
    const provider = new WatchedProvider();
    const told: string[] = [];
    const { pass } = lintPass(tree, provider, {
      onKeying: (keying) => {
        provider.keying = keying;
        told.push(keying ? "keying" : "keyed");
      },
      onPass: () => told.push("pass"),
    });
    pass.nudge();
    await pass.idle();
    await pass.close();
    expect(provider.inputCalls).toHaveLength(1);
    expect(provider.keyingAtInputs).toEqual([false, false]);
    expect(told).toEqual(["keying", "keyed", "pass"]);
  });

  it("onKeying is never told when the provider refuses its inputs", async () => {
    const tree = lintTree().write("src/a.js", "ok\n");
    tree.revise();
    const provider = new FakeProvider();
    provider.failInputs = "config does not load";
    const told: boolean[] = [];
    const { pass } = lintPass(tree, provider, { onKeying: (keying) => told.push(keying) });
    pass.nudge();
    await pass.idle();
    await pass.close();
    expect(told).toEqual([]);
  });
});
