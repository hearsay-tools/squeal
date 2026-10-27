import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { blobHash } from "../../../src/core/hash/index.js";
import type { Major } from "../provider/helpers.js";
import { eslintRig } from "./eslint-rig.js";

export const HEAD = "Lint: 1 file changed since this session started";
const RULES = "rules.mjs";
const rules = (enabled: string) => `export default { "${enabled}": "error" };\n`;

/** The review's unlisted imported config change, without a worktree revision. */
export async function sameRevisionRig(major: Major, history: "pass" | "fail", attackAt?: string) {
  let armed = false;
  let attacked = false;
  const rig = await eslintRig(
    major,
    {
      "package.json": '{ "type": "module" }\n',
      "eslint.config.js": `import rules from "./${RULES}";
export default [{ ignores: ["eslint.config.js"] }, { rules }];\n`,
      "src/a.js": "const count=1;\n",
    },
    {
      unlisted: { [RULES]: rules(history === "pass" ? "no-unused-vars" : "no-console") },
      afterCall(call, root) {
        if (!armed || attacked || call !== attackAt) return;
        attacked = true;
        writeFileSync(join(root, RULES), rules("no-undef"));
      },
    },
  );
  expect(rig.findings()).toHaveLength(history === "pass" ? 1 : 0);
  await rig.edit({
    "src/a.js": history === "pass" ? 'console.log("x");\n' : 'const count=1;\nconsole.log("x");\n',
  });
  expect(rig.findings()).toHaveLength(history === "pass" ? 0 : 1);
  const change =
    history === "pass"
      ? "  PASS lint: src/a.js: no findings; at revision 2"
      : "  FAIL lint: src/a.js: 1 finding, +1 no-console (Unexpected console statement.); at revision 2";
  const current = history === "pass" ? "pass: no findings" : "fail: 1 finding";
  expect(await rig.changed()).toBe(`${HEAD}\n${change}; now ${current}, linted at revision 2\n`);
  const before = rig.readKey();
  expect(before.blobs.get(RULES)).toBe(
    blobHash(Buffer.from(rules(history === "pass" ? "no-unused-vars" : "no-console")), "sha1"),
  );
  expect(rig.tree.source.file(RULES)).toBeNull();

  // A no-op nudge must keep the result and the report unchanged.
  const unchanged = await rig.changedJson();
  await rig.settle();
  expect(rig.key()).toBe(before.key);
  expect(await rig.changedJson()).toEqual(unchanged);

  armed = true;
  const enabled = history === "pass" ? "no-console" : "no-unused-vars";
  rig.writeDisk(RULES, rules(enabled));
  await rig.settle();
  expect(attacked).toBe(attackAt !== undefined);
  expect(rig.tree.source.latestRevision()).toBe(2);
  // The first pass can finish using bytes sampled before the forced edit.
  // Its key must identify those actual reads, never the newer disk bytes.
  const first = rig.readKey();
  expect(first.key).not.toBe(before.key);
  if (attacked) await rig.settle();
  const after = rig.readKey();
  expect(after.key).not.toBe(before.key);
  const usedRule = attackAt === undefined ? enabled : "no-undef";
  expect(after.blobs.get(RULES)).toBe(blobHash(Buffer.from(rules(usedRule)), "sha1"));
  const findings = rig.findings();
  expect(findings).toHaveLength(1);
  expect(findings[0]).toMatch(new RegExp(`^${usedRule} `));
  return { rig, change };
}
