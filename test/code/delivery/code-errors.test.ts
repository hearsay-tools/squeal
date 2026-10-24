import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { countFile } from "../../../src/core/code/count/index.js";
import { judge } from "../../../src/core/code/pass/judge.js";
import { isCodeStoreOpenFailure, openCodeStore } from "../../../src/core/code/store/index.js";
import { type Seeded, seed } from "../../status/slow-tier-seed.js";
import { ON } from "../helpers.js";

/*
 * Review 0.1.283 B4, spec 015 D3, D6: `squeal code` names every file whose
 * stored count has parse errors, from the count's `errors`, with the
 * functions in them as detail; a file with no function and an error
 * outside a healthy function are named too. Real counts, judged by the pass.
 */

const FILES: Record<string, string> = {
  "src/brace.ts": "function g(x) { if (x) return 1;",
  "src/empty.ts": "const x = ;",
  "src/fine.ts": "function h() { return 0; }",
  "src/healthy.ts": "function f(x) { if (x) { return 1; }}\nconst y = ;\n",
};

/** Every file of `FILES` counted and judged at threshold 1, as the pass stores them. */
async function seeded(): Promise<Seeded> {
  const s = seed({ complexity: { enabled: true, threshold: 1 } });
  const id = s.repo.mainId;
  const code = openCodeStore(s.repo.commonDir, ON);
  if (isCodeStoreOpenFailure(code)) throw new Error(JSON.stringify(code));
  const after = [];
  for (const [path, text] of Object.entries(FILES)) {
    const count = await countFile(text, "typescript");
    code.counts.put(count, 1_000);
    code.files.upsertMany(id, [
      {
        path,
        blob: count.blob,
        language: "typescript",
        counterVersion: count.counterVersion,
        size: text.length,
        revision: 1,
      },
    ]);
    after.push({ path, count });
  }
  const { states } = judge({
    worktreeId: id,
    revision: 1,
    threshold: 1,
    at: 1_000,
    quiet: true,
    before: [],
    bodies: new Map(),
    after,
  });
  code.states.upsertMany(states);
  code.close();
  return s;
}

function run(s: Seeded, args: string[]) {
  let out = "";
  const code = main(["code", ...args], {
    stdout: (t) => {
      out += t;
    },
    stderr: () => {},
    cwd: s.repo.main,
    env: {},
  });
  return { code, out };
}

const parseError = (path: string, unknown: number) => ({
  path,
  reason: "parse-error",
  size: FILES[path]?.length,
  unknown,
});

describe("squeal code names the files with parse errors (review 0.1.283 B4)", () => {
  it("lists each file whose count has errors in JSON, with the functions in them", async () => {
    const s = await seeded();
    const { code, out } = run(s, ["--json"]);
    expect(code).toBe(0);
    const report = JSON.parse(out);
    expect(report.functions.map((f: { path: string }) => f.path)).toEqual(["src/healthy.ts"]);
    expect(report.files).toEqual([
      parseError("src/brace.ts", 1),
      parseError("src/empty.ts", 0),
      parseError("src/healthy.ts", 0),
    ]);
  });

  it("lists them after the functions in text", async () => {
    const s = await seeded();
    const { code, out } = run(s, []);
    expect(code).toBe(0);
    expect(out.split("\n").slice(-5)).toEqual([
      "Not judged:",
      "  src/brace.ts: does not parse; 1 function in its errors not judged",
      "  src/empty.ts: does not parse; 0 functions in its errors not judged",
      "  src/healthy.ts: does not parse; 0 functions in its errors not judged",
      "",
    ]);
  });

  it("names a file with no function when its path is asked for", async () => {
    const s = await seeded();
    const report = JSON.parse(run(s, ["src/empty.ts", "--json"]).out);
    expect(report).toMatchObject({ functions: [], files: [parseError("src/empty.ts", 0)] });
    expect(run(s, ["src/empty.ts"]).out).toContain(
      "  src/empty.ts: does not parse; 0 functions in its errors not judged",
    );
  });

  it("keeps a healthy function beside an error judged, and its file named", async () => {
    const s = await seeded();
    const report = JSON.parse(run(s, ["src/healthy.ts", "--json"]).out);
    expect(report.functions).toMatchObject([
      { qualifiedName: "f", outcome: "fail", complexity: 2 },
    ]);
    expect(report.files).toEqual([parseError("src/healthy.ts", 0)]);
  });
});
