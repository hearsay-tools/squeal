import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { dateOf, duration, shellQuote } from "../../src/core/ps/flags-text.js";

/* Spec 014 D7: "Each end command quotes its paths for the shell." */

/** What `sh` gives back as one argument for `word` quoted. */
function shellReads(word: string): string[] {
  const out = execFileSync("sh", ["-c", `printf '%s\\0' ${shellQuote(word)}`], {
    encoding: "utf8",
  });
  return out.split("\0").slice(0, -1);
}

describe("shellQuote", () => {
  it("leaves a plain path bare", () => {
    expect(shellQuote("/run/user/1001/squeal-fd5a859b8ca77ef9.sock")).toBe(
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
    expect(shellQuote("/home/u/it's a dir")).toBe("'/home/u/it'\\''s a dir'");
  });
});

describe("dateOf and duration", () => {
  it("print a UTC minute and a short duration", () => {
    expect(dateOf(Date.UTC(2026, 9, 16, 20, 36, 59))).toBe("2026-10-16 20:36 UTC");
    expect([45_000, 119_999, 120_000, 7_199_000, 7_200_000, 11_100_000].map(duration)).toEqual([
      "45 s",
      "119 s",
      "2m",
      "119m",
      "2h 00m",
      "3h 05m",
    ]);
  });
});
