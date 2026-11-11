import { rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { resolveCommonDir } from "../../src/core/fs/git-layout.js";
import { storePaths } from "../../src/core/store/paths.js";
import { committed, scratchDir, writeFiles } from "../ci/fixture.js";
import { MATH_FILES } from "../runners/vitest/ci-coverage-kit.js";
import { gate, recordInto, SLOW } from "./code-gate-parts-kit.js";

/*
 * Spec 020 D13.2, row 020-20: `--parts` certifies the inputs of a part's
 * file as the daemon's record keys them (`inputsOfReads`). A test that
 * reads `data.json`, a link to `fixtures/data.json`, or `linked/data.json`,
 * where `linked` is a link to `fixtures`, has `fixtures/data.json` among
 * them, the link's target: when the target changes after `ci record`, the
 * gate runs the file. `data.json`'s own content is its link text, which
 * does not change.
 */

/** A test that reads `path` at run time, outside every import graph. */
const reads = (path: string) =>
  `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\n\nit("reads its data through a link", () => {\n  expect(JSON.parse(readFileSync(new URL("../${path}", import.meta.url), "utf8")).n).toBe(1);\n});\n`;

const FILES: Readonly<Record<string, string>> = {
  ...MATH_FILES,
  "src/math.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  "fixtures/data.json": `{ "n": 1 }\n`,
  "test/link.test.ts": reads("data.json"),
  "test/linked.test.ts": reads("linked/data.json"),
};

const ARGS = ["src/math.ts", "--test", "test/link.test.ts", "--test", "test/linked.test.ts"];

/** The links, before the commit. */
function link(at: string): void {
  symlinkSync("fixtures/data.json", join(at, "data.json"));
  symlinkSync("fixtures", join(at, "linked"));
}

let dir: string;
let root: string;
let parts: string;

beforeAll(async () => {
  dir = scratchDir("gate-parts-link");
  root = committed(dir, FILES, link);
  writeFiles(root, { "src/math.ts": MATH_FILES["src/math.ts"] as string });
  parts = await recordInto(root, "parts");
}, SLOW.timeout);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

// D17.3: the gate keeps what it runs; each case starts with no stores.
afterEach(() => {
  const common = root === undefined ? null : resolveCommonDir(root);
  if (common !== null) rmSync(storePaths(common).dir, { recursive: true, force: true });
});

describe("squeal code --base --parts: a read through a link (spec 020 D13.2, row 020-20)", () => {
  it("takes the file while the link's target is unchanged", SLOW, async () => {
    const ran = await gate(root, [...ARGS, "--parts", parts]);

    expect(ran.ran).toEqual([]);
    expect(ran.report.runs[0]?.from).toMatchObject({
      "test/link.test.ts": "parts",
      "test/linked.test.ts": "parts",
    });
  });

  it("runs the file once the link's target changed after ci record", SLOW, async () => {
    const target = join(root, "fixtures/data.json");
    try {
      writeFileSync(target, `{ "n": 2 }\n`);

      const ran = await gate(root, [...ARGS, "--parts", parts]);

      expect(ran.ran).toEqual(["test/link.test.ts", "test/linked.test.ts"]);
      expect(ran.report.runs[0]?.from).toMatchObject({
        "test/link.test.ts": "run",
        "test/linked.test.ts": "run",
      });
    } finally {
      writeFileSync(target, FILES["fixtures/data.json"] as string);
    }
  });
});
