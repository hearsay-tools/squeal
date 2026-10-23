import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cap, plural, shellWord } from "../src/core/text.js";

describe("plural", () => {
  it("adds an s unless the count is one", () => {
    expect(plural(0, "check")).toBe("0 checks");
    expect(plural(1, "check")).toBe("1 check");
    expect(plural(2, "test file")).toBe("2 test files");
  });
});

describe("cap", () => {
  it("keeps text within the limit and cuts longer text to the limit with ...", () => {
    expect(cap("abcdef", 6)).toBe("abcdef");
    expect(cap("abcdefg", 6)).toBe("abc...");
  });
});

/* Spec 014 D7: "Each end command quotes its paths for the shell." Row 011-130: every printed command. */
describe("shellWord", () => {
  /** What `sh` gives back as one argument for `word` quoted. */
  function shellReads(word: string): string[] {
    const out = execFileSync("sh", ["-c", `printf '%s\\0' ${shellWord(word)}`], {
      encoding: "utf8",
    });
    return out.split("\0").slice(0, -1);
  }

  it("leaves a plain path bare", () => {
    expect(shellWord("/run/user/1001/squeal-fd5a859b8ca77ef9.sock")).toBe(
      "/run/user/1001/squeal-fd5a859b8ca77ef9.sock",
    );
  });

  it("gives the shell back each path whole: a space, a quote, $, a glob, a newline, empty", () => {
    for (const word of [
      "/home/u/it's a dir/x",
      "/tmp/$HOME `id`",
      "/tmp/*",
      "/tmp/a\nb",
      "",
      "-rf",
    ])
      expect(shellReads(word)).toEqual([word]);
    expect(shellWord("/home/u/it's a dir")).toBe("'/home/u/it'\\''s a dir'");
  });
});
