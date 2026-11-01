import { describe, expect, it } from "vitest";
import { stripJsonc } from "../../../src/core/lint/provider/oxlint/configs.js";

/*
 * Spec 017 D11 "Key": the JSONC reader that finds a config's `extends`
 * closure. Review 0.1.391 B2: a trailing-comma rule that ran inside strings
 * changed `./configs/base,}.json` to a path that does not exist.
 */

const parse = (text: string) => JSON.parse(stripJsonc(text));

describe("stripJsonc", () => {
  it("keeps a comma before } or ] inside a string", () => {
    expect(parse('{"extends":["./configs/base,}.json"]}')).toEqual({
      extends: ["./configs/base,}.json"],
    });
    expect(parse('{"extends":["./x,].json", "./y, ].json"]}')).toEqual({
      extends: ["./x,].json", "./y, ].json"],
    });
  });

  it("keeps comment marks and escaped quotes inside a string", () => {
    expect(parse('{"a":"// not a comment","b":"/* nor */","c":"q\\",}"}')).toEqual({
      a: "// not a comment",
      b: "/* nor */",
      c: 'q",}',
    });
  });

  it("drops trailing commas outside strings, with whitespace or comments before the bracket", () => {
    expect(parse('{"a":[1,2,],"b":{"c":3,},}')).toEqual({ a: [1, 2], b: { c: 3 } });
    expect(parse('{"a":[1, /* last */ ], "b": 2, // end\n}')).toEqual({ a: [1], b: 2 });
  });

  it("drops line and block comments", () => {
    expect(parse('// head\n{ /* x */ "a": 1 // tail\n}\n')).toEqual({ a: 1 });
  });

  it("keeps a comma that a value follows", () => {
    expect(parse('{"a":1, /* c */ "b":2}')).toEqual({ a: 1, b: 2 });
  });
});
