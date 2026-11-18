import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { patchPlugins } from "../../evals/lib/index.mjs";

// Row 005-127, forms E and F of the start-message experiment (the human, 2026-11-18): each
// variant applied to a copy of the pinned plugin tree's shape. The skill files are this tree's
// (they are those of 86fd6c9ce, the commit the variants run against); the 25 bundles hold the
// minimal form's switch and last template line as 86fd6c9ce's bundles do.
const REPO = join(import.meta.dirname, "../..");
const variant = (name: string) =>
  JSON.parse(readFileSync(join(REPO, "evals/variants", `${name}.json`), "utf8"));
/** The template expression before "has the rest." in a bundle at 86fd6c9ce. */
const HELP = ["$", '{capital(cli("--help"))}'].join("");
/** The minimal form's last sentence in a bundle at 86fd6c9ce, and its switch. */
const BUNDLE = [
  'var PRIMER_FORM = "full";',
  "    const rest = [",
  `      \`${HELP} has the rest.\`,`,
  '      ...naming === "none" ? ["These are commands of the CLI SQUEAL messages name."] : []',
  "    ];",
  "",
].join("\n");
/** The plugins and paths that hold the skill, as the pin has them. */
const SKILLS = [
  "claude-code/skills/squeal",
  "codex-runtime/skills/squeal",
  "pi/skills/squeal",
  "codex/skills/squeal",
  "codex/seed/skills/squeal",
];
const STEPS = SKILLS.filter((s) => s !== "codex/skills/squeal");
const OLD_DESC =
  "description: Use when about to run tests (vitest, npm test) or to check whether a change broke something, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the suites its primer lists as covered; this says when to wait for their results and how to read its reports.";
const NEW_DESC =
  "description: Use before you run tests yourself, and when a test fails or a SQUEAL message reports a failure, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the tests in the background; this says what to do instead of a hand run, how to retry a failure you did not cause, and how to read its reports.";
const RETRY =
  "3. **A failure you did not cause** (its report says it was recorded before your edit, or it comes from host load or a stopped service): do not run the tests yourself to check it. Ask Squeal to run it once more: `squeal retry <file> --reason load`, or `--reason environment` once the service runs again; then `squeal status --wait 60000 <file>` and claim from that result. Never retry past a failure your change could have caused.";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
/** A plugins tree: the skill copies, `bundles` bundles over four plugins; `drop` skill copies left out. */
function plugins(bundles = 25, drop: string[] = []) {
  const d = mkdtempSync(join(tmpdir(), "squeal-skill-variant-"));
  dirs.push(d);
  for (const s of SKILLS.filter((x) => !drop.includes(x)))
    cpSync(join(REPO, "plugins", s), join(d, s), { recursive: true });
  const owners = ["claude-code", "codex-runtime", "opencode", "pi"];
  for (let i = 0; i < bundles; i++) {
    const dir = join(d, owners[i % owners.length] as string, "dist");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `b${i}.mjs`), BUNDLE);
  }
  return d;
}
const read = (d: string, p: string) => readFileSync(join(d, p), "utf8");
const steps = (text: string) => text.split("\n").filter((l) => /^\d\. \*\*/.test(l));

describe.each([
  ["primer-minimal-skill", "E"],
  ["primer-minimal-desc", "F"],
])("variant %s (form %s)", (name, form) => {
  it("matches every patch exactly its minimum on the pinned shape", () => {
    const v = variant(name);
    const applied = patchPlugins(plugins(), v);
    expect(applied.map((a: { count: number }) => a.count)).toEqual(
      v.patch.map((p: { min: number }) => p.min),
    );
    expect(v.plugin).toBe(true);
    expect(v.patch[0]).toEqual({
      files: "plugins/*/dist/**/*.mjs",
      find: 'var PRIMER_FORM = "full";',
      replace: 'var PRIMER_FORM = "minimal";',
      min: 25,
    });
  });

  it("gives every copy that holds the steps the retry step 3, and renumbers the rest", () => {
    const d = plugins();
    patchPlugins(d, variant(name));
    for (const s of STEPS) {
      const text = read(d, `${s}/SKILL.md`);
      const list = steps(text);
      expect(
        list.map((l) => l.slice(0, 2)),
        s,
      ).toEqual(["1.", "2.", "3.", "4.", "5.", "6."]);
      expect(list[2], s).toBe(RETRY);
      expect(list[3], s).toMatch(
        /^4\. \*\*Wait only when you need a result before your next step\*\*/,
      );
      expect(list[4], s).toMatch(/^5\. \*\*Before you say the task is done/);
      expect(list[5], s).toMatch(/^6\. \*\*Run tests yourself only\*\*/);
      expect(text, s).toContain("but not for slow files (step 5)");
      expect(text, s).toContain("not what step 4 or 5 expects");
      expect(text, s).not.toMatch(/step 3's path wait|\(step 4\)|step 3 or 4/);
      const commands = read(d, `${s}/references/commands.md`);
      expect(commands.match(/the skill's step \d/gi), s).toEqual([
        "The skill's step 5",
        "the skill's step 5",
      ]);
    }
    for (const s of ["claude-code", "codex-runtime", "pi"].map((p) => `${p}/skills/squeal`))
      expect(read(d, `${s}/SKILL.md`)).toContain("starting, use step 4's path wait instead");
    // The Codex plugin's own SKILL.md points to the runtime's and holds no steps.
    expect(steps(read(d, "codex/skills/squeal/SKILL.md"))).toEqual([]);
  });

  it(`gives form ${form}'s start message and description`, () => {
    const d = plugins();
    patchPlugins(d, variant(name));
    const bundle = read(d, "claude-code/dist/b0.mjs");
    expect(bundle).toContain('var PRIMER_FORM = "minimal";');
    const descriptions = SKILLS.map((s) => read(d, `${s}/SKILL.md`).split("\n")[2]);
    if (form === "E") {
      expect(bundle).toContain(
        `\`${HELP} has the rest. Read the squeal skill before you run or judge tests.\`,`,
      );
      expect(descriptions).toEqual(SKILLS.map(() => OLD_DESC));
    } else {
      expect(bundle).toContain(`\`${HELP} has the rest.\`,`);
      expect(bundle).not.toContain("Read the squeal skill");
      expect(descriptions).toEqual(SKILLS.map(() => NEW_DESC));
    }
  });

  it("fails loudly on a tree with fewer matches than a patch's minimum", () => {
    expect(() => patchPlugins(plugins(24), variant(name))).toThrow(
      /matched 24 times, expected at least 25/,
    );
    expect(() => patchPlugins(plugins(25, ["pi/skills/squeal"]), variant(name))).toThrow(
      /matched 2 times, expected at least 3/,
    );
    expect(() => patchPlugins(plugins(25, ["codex/seed/skills/squeal"]), variant(name))).toThrow(
      /matched 0 times, expected at least 1/,
    );
  });
});
