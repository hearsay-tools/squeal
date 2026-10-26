import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { OWN, starterOf } from "../../../src/core/lint/provider/wraps.js";

/*
 * Wave 1.8: the reason a lint after a worker thread stores nothing names
 * the packages that started the thread, as the stack shows them.
 */

const site = (file: string | null) => ({ getFileName: () => file }) as unknown as NodeJS.CallSite;
const modules = (...parts: string[]) => join("/p", "node_modules", ...parts);
const own = [...OWN].find((file) => !file.startsWith("file:")) ?? "";

describe("the code that started a worker thread (wave 1.8)", () => {
  it("names the innermost two packages and skips Node's frames", () => {
    const sites = [
      "node:internal/worker",
      modules("synckit", "lib", "index.js"),
      modules("synckit", "lib", "index.js"),
      modules("eslint-plugin-prettier", "eslint-plugin-prettier.js"),
      modules("eslint", "lib", "linter", "linter.js"),
      modules("prettier", "index.mjs"),
    ].map(site);
    expect(starterOf(sites)).toBe("synckit, called by eslint-plugin-prettier");
  });

  it("names a scoped package, a file URL and a package under pnpm's store", () => {
    expect(starterOf([site(pathToFileURL(modules("@scope", "plugin", "index.js")).href)])).toBe(
      "@scope/plugin",
    );
    expect(
      starterOf([site(modules(".pnpm", "synckit@0.11.8", "node_modules", "synckit", "index.js"))]),
    ).toBe("synckit");
  });

  it("names a project file by its path, and ESLint only when no other code is there", () => {
    expect(starterOf([site(null), site(""), site("/p/rules/rule.js")])).toBe("/p/rules/rule.js");
    expect(
      starterOf([
        site(modules("@eslint", "js", "index.js")),
        site(modules("eslint", "lib", "x.js")),
      ]),
    ).toBe("@eslint/js");
    expect(starterOf([])).toBeNull();
  });

  it("stops at the worker's own code", () => {
    expect(starterOf([site(own), site(modules("synckit", "index.js"))])).toBeNull();
    expect(starterOf([site(modules("synckit", "index.js")), site(own), site("/p/a.js")])).toBe(
      "synckit",
    );
  });
});
