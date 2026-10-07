import { beforeAll, describe, expect, it } from "vitest";
import { parseModule, parserReady } from "../../../src/runners/node-test/graph/parse.js";

/**
 * Review wave 2, N3: only code marks a module incomplete. A `require (` in a
 * comment or a string is prose; a computed `require(x)` in code, including
 * inside a template literal's `${}`, still is one (D3, wave 1 N6).
 */

beforeAll(() => parserReady);

const reasons = (source: string) => parseModule(source, "m.ts").incomplete;

describe("parseModule's computed require()", () => {
  it("ignores a require call in comments and strings", () => {
    const source = [
      "// these tests require (at least) Node 22",
      "/* and require(x) here",
      "   spans lines */",
      `const a = "require(x)";`,
      `const b = 'require (y)';`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's own template literal.
      "const c = `require(${'z'})`;",
      `const d = /require\\(/;`,
      `const e = "a // b"; const f = require("./f.js");`,
      "",
    ].join("\n");
    expect(reasons(source)).toEqual([]);
    expect(parseModule(source, "m.ts").specifiers).toContainEqual({
      specifier: "./f.js",
      kind: "require",
    });
  });

  it("still marks a computed require in code", () => {
    const source = [
      `const name = "x"; // a comment`,
      "const a = require(name);",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's own template literal.
      "const b = `${require(name)}`;",
      `const c = 1 / 2; const d = require(name);`,
      "",
    ].join("\n");
    expect(reasons(source)).toEqual([
      "require() with a computed specifier at m.ts:2:11",
      "require() with a computed specifier at m.ts:3:14",
      "require() with a computed specifier at m.ts:4:28",
    ]);
  });
});
