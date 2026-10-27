import { describe, expect, it } from "vitest";
import { config, eslintRig } from "./eslint-rig.js";

/*
 * Review 0.1.360 B2 with the real provider, ESLint 9 and 10 and their core
 * rules: a config change judges `src/a.js` again with no transition (D2),
 * and `squeal lint --changed` tells the session's change as history, then
 * the file's result now. Each stored result equals a fresh `eslint -f json`.
 */

const HEAD = "Lint: 1 file changed since this session started";
const UNUSED = "no-unused-vars 'count' is assigned a value but never used.";
const CONSOLE = "no-console Unexpected console statement.";

describe.each([9, 10] as const)(
  "squeal lint --changed after a config change, ESLint %i",
  (major) => {
    it("case A: a PASS change the config made fail since says it fails now", async () => {
      const rig = await eslintRig(major, {
        "eslint.config.js": config({ "no-unused-vars": "error", "no-console": "off" }),
        "src/a.js": 'const count=1;\nconsole.log("x");\n',
      });
      expect(rig.findings()).toEqual([UNUSED]);
      await rig.edit({ "src/a.js": 'console.log("x");\n' });
      expect(rig.findings()).toEqual([]);
      // Control: the PASS is the result now.
      expect(await rig.changed()).toBe(
        `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now pass: no findings, linted at revision 2\n`,
      );
      await rig.edit({
        "eslint.config.js": config({ "no-unused-vars": "error", "no-console": "warn" }),
      });
      expect(rig.findings()).toEqual([CONSOLE]);
      expect(await rig.changed()).toBe(
        `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; now fail: 1 finding, linted at revision 3\n`,
      );
    }, 60_000);

    it("a FAIL change the config judged again with another rule, the same count, is history", async () => {
      const rig = await eslintRig(major, {
        "eslint.config.js": config({ "no-console": "warn", "no-unused-vars": "off" }),
        "src/a.js": "const count=1;\n",
      });
      expect(rig.findings()).toEqual([]);
      await rig.edit({ "src/a.js": 'const count=1;\nconsole.log("x");\n' });
      expect(rig.findings()).toEqual([CONSOLE]);
      const change =
        "  FAIL lint: src/a.js: 1 finding, +1 no-console (Unexpected console statement.); at revision 2";
      // Control: the FAIL is the result now.
      expect(await rig.changed()).toBe(
        `${HEAD}\n${change}; now fail: 1 finding, linted at revision 2\n`,
      );
      await rig.edit({
        "eslint.config.js": config({ "no-console": "off", "no-unused-vars": "error" }),
      });
      expect(rig.findings()).toEqual([UNUSED]);
      expect(await rig.changed()).toBe(
        `${HEAD}\n${change}; now fail: 1 finding, linted at revision 3\n`,
      );
    }, 60_000);
  },
);
