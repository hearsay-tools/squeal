import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchPlugins } from "../../evals/lib/index.mjs";

// Row 005-127, the start-message experiment's full check (the human, 2026-11-18): variants
// primer-skill and primer-skill-noproof on a copy of the pinned plugin tree's shape. The skill
// files are this tree's, the same as main's and 86fd6c9ce's (005-126 does not change them). The
// commit under test is not built yet, so the 25 bundles are a text holding the switch's line as
// 005-126's build writes it, `var PRIMER_FORM = "full";`.
const REPO = join(import.meta.dirname, "../..");
const variant = (name: string) =>
  JSON.parse(readFileSync(join(REPO, "evals/variants", `${name}.json`), "utf8"));
const SKILLS = [
  "claude-code/skills/squeal",
  "codex-runtime/skills/squeal",
  "pi/skills/squeal",
  "codex/skills/squeal",
  "codex/seed/skills/squeal",
];
/** The copies that hold the steps; `codex/skills/squeal` points to the runtime's. */
const STEPS = SKILLS.filter((s) => s !== "codex/skills/squeal");
const TITLES = [
  "Learn this repository's checks first.",
  "Keep working, and read the reports.",
  "On a FAIL",
  "A failure you did not cause",
  "Wait only when you need a result before your next step",
  "Before you say the task is done, make the evidence current.",
  "Run tests yourself only",
  "Results at another commit, and red proofs.",
];

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** A plugins tree: the skill copies (but `drop`), `bundles` bundles holding the switch. */
function plugins(bundles = 25, drop: string[] = []) {
  const d = mkdtempSync(join(tmpdir(), "squeal-skill-form-"));
  dirs.push(d);
  for (const s of SKILLS.filter((x) => !drop.includes(x)))
    cpSync(join(REPO, "plugins", s), join(d, s), { recursive: true });
  const owners = ["claude-code", "codex-runtime", "opencode", "pi"];
  for (let i = 0; i < bundles; i++) {
    const dir = join(d, owners[i % owners.length] as string, "dist");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `b${i}.mjs`), 'var PRIMER_FORM = "full";\n');
  }
  return d;
}
const read = (d: string, p: string) => readFileSync(join(d, p), "utf8");
const steps = (text: string) => text.split("\n").filter((l) => /^\d+\. \*\*/.test(l));

describe.each([
  ["primer-skill", true],
  ["primer-skill-noproof", false],
])("variant %s", (name, proof) => {
  const patched = () => {
    const d = plugins();
    return { d, applied: patchPlugins(d, variant(name)) };
  };

  it("matches every patch exactly its minimum, the switch in 25 bundles", () => {
    const { d, applied } = patched();
    const v = variant(name);
    expect(applied.map((a: { count: number }) => a.count)).toEqual(
      v.patch.map((p: { min: number }) => p.min),
    );
    expect(read(d, "claude-code/dist/b0.mjs")).toBe('var PRIMER_FORM = "skill";\n');
  });

  it("numbers the steps 1 to n with no gap, in every copy that holds them", () => {
    const { d } = patched();
    const titles = proof ? TITLES : TITLES.slice(0, 7);
    for (const s of STEPS) {
      const list = steps(read(d, `${s}/SKILL.md`));
      expect(
        list.map((l) => l.split(". ")[0]),
        s,
      ).toEqual(titles.map((_, i) => String(i + 1)));
      for (const [i, l] of list.entries()) expect(l, s).toContain(`**${titles[i]}`);
      expect(list[0], s).toContain("Run `squeal checks` once.");
    }
    expect(steps(read(d, "codex/skills/squeal/SKILL.md"))).toEqual([]);
  });

  it("moves every reference to a step number with its step", () => {
    const { d } = patched();
    for (const s of STEPS) {
      const text = read(d, `${s}/SKILL.md`);
      expect(text, s).toContain("but not for slow files (step 6)");
      expect(text, s).toContain("not what step 5 or 6 expects");
      expect(read(d, `${s}/references/commands.md`).match(/the skill's step \d/gi), s).toEqual([
        "The skill's step 6",
        "the skill's step 6",
      ]);
    }
    for (const p of ["claude-code", "codex-runtime", "pi"])
      expect(read(d, `${p}/skills/squeal/SKILL.md`)).toContain("use step 5's path wait instead");
  });

  it("leaves no 'primer' in any copy of the skill, its references included", () => {
    const { d } = patched();
    for (const s of SKILLS) {
      expect(read(d, `${s}/SKILL.md`), s).not.toMatch(/primer/i);
      if (s !== "codex/skills/squeal")
        for (const r of ["commands", "policy", "reports"])
          expect(read(d, `${s}/references/${r}.md`), `${s} ${r}`).not.toMatch(/primer/i);
    }
  });

  it("gives all five copies one description", () => {
    const { d } = patched();
    const descriptions = new Set(SKILLS.map((s) => read(d, `${s}/SKILL.md`).split("\n")[2]));
    expect(descriptions.size).toBe(1);
    const [description] = [...descriptions];
    expect(description).toMatch(/^description: Use before you run tests yourself, /);
    expect(description?.includes("to show that a test catches a bug")).toBe(proof);
    expect(description).toContain("this says which checks this repository defines");
  });

  it("fails loudly on a tree with fewer matches than a patch's minimum", () => {
    expect(() => patchPlugins(plugins(24), variant(name))).toThrow(
      /matched 24 times, expected at least 25/,
    );
    expect(() => patchPlugins(plugins(25, ["pi/skills/squeal"]), variant(name))).toThrow(
      /matched 4 times, expected at least 5/,
    );
  });
});

describe("the two variants, one wording", () => {
  it("differ only in the proof parts: the description's middle and the last step", () => {
    const [full, noproof] = ["primer-skill", "primer-skill-noproof"].map(variant);
    expect(full.patch.slice(0, -1).length).toBe(noproof.patch.length);
    const strip = (p: { replace: string }, i: number) => (i === 1 ? { ...p, replace: "" } : p);
    expect(full.patch.slice(0, -1).map(strip)).toEqual(noproof.patch.map(strip));
    expect(
      full.patch[1].replace
        .replace(
          ", to show that a test catches a bug (fails without the fix), or to compare test results with an earlier commit",
          "",
        )
        .replace("yourself, when", "yourself, or when"),
    ).toBe(noproof.patch[1].replace);
    expect(full.patch.at(-1).replace).toMatch(
      /^\n8\. \*\*Results at another commit, and red proofs\.\*\*/,
    );
  });
});
