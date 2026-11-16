import { describe, expect, it } from "vitest";
import { folderListings, globPatterns } from "../../../src/runners/vitest/glob-listing.js";

/*
 * Row 023-13 (fix A): the folders a module's real globs list, read from its
 * syntax tree and resolved as Vite 8 does (`toAbsoluteGlob`, `getCommonBase`,
 * `dynamicImportToGlob`). Glob text in a comment or a string lists nothing.
 */

const ROOT = "/repo";
const FILE = "/repo/src/registry.ts";
const noResolve = async () => null;

const listings = (source: string, file = FILE, resolve = noResolve) =>
  folderListings(file, source, ROOT, resolve);

describe("glob listings of a module (row 023-13)", () => {
  it("lists the base folder of a relative glob, flat when the rest has no slash", async () => {
    const source = 'const p = import.meta.glob("./plugins/*.ts", { eager: true });\n';
    expect(await listings(source)).toEqual([{ directory: "/repo/src/plugins", recursive: false }]);
  });

  it("lists recursively where the rest holds ** or a slash", async () => {
    const source = [
      'import.meta.glob("../pages/**/*.ts");',
      'import.meta.glob("./widgets/*/index.ts");',
    ].join("\n");
    expect(await listings(source)).toEqual([
      { directory: "/repo/pages", recursive: true },
      { directory: "/repo/src/widgets", recursive: true },
    ]);
  });

  it("resolves / from the root, a base option, arrays, and skips negations", async () => {
    const source = [
      'import.meta.glob(["/data/*.json", "!/data/skip.json"]);',
      'import.meta.glob("./*.md", { base: "/docs" });',
      'import.meta.glob("./*.md", { base: "../notes" });',
    ].join("\n");
    expect(await listings(source)).toEqual([
      { directory: "/repo/data", recursive: false },
      { directory: "/repo/docs", recursive: false },
      { directory: "/repo/notes", recursive: false },
    ]);
  });

  it("resolves an alias or a # subpath through the resolver", async () => {
    const asked: string[] = [];
    const resolve = async (pattern: string) => {
      asked.push(pattern);
      return pattern.startsWith("@/") ? `/repo/src/${pattern.slice(2)}` : null;
    };
    const source = 'import.meta.glob("@/routes/*.ts");\nimport.meta.glob("#gone/*.ts");\n';
    expect(await listings(source, FILE, resolve)).toEqual([
      { directory: "/repo/src/routes", recursive: false },
    ]);
    expect(asked).toEqual(["@/routes/*.ts", "#gone/*.ts"]);
  });

  it("converts a template-literal import() as dynamicImportToGlob does", async () => {
    const source = [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's own template literal.
      "export const load = (l: string) => import(`./locales/${l}.ts`);",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's own template literal.
      "export const deep = (a: string, b: string) => import(`../themes/${a}/${b}.css`);",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: no extension: Vite leaves it alone.
      "export const bare = (x: string) => import(`./x/${x}`);",
      "export const plain = () => import(`./fixed.ts`);",
    ].join("\n");
    expect(await listings(source)).toEqual([
      { directory: "/repo/src/locales", recursive: false },
      { directory: "/repo/themes", recursive: true },
    ]);
  });

  it("reads TypeScript: a type argument, an interface and annotations", async () => {
    const source = [
      "interface Mod { name: string }",
      'const mods = import.meta.glob<Mod>("./plugins/*.ts", { eager: true });',
      "export const names: string[] = Object.values(mods).map((m) => (m as Mod).name);",
    ].join("\n");
    expect(await listings(source)).toEqual([{ directory: "/repo/src/plugins", recursive: false }]);
  });

  it("lists nothing for glob text only in a comment or a string", async () => {
    const source = [
      "// import.meta.glob('./plugins/*.ts')",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the module's comment holds the text.
      "/* import(`./x/${y}.ts`) */",
      "export const DYNAMIC = /import\\.meta\\.glob|\\bimport\\s*\\(\\s*`[^`]*\\$\\{/;",
      'export const doc = "import.meta.glob(\\"./plugins/*.ts\\")";',
    ].join("\n");
    expect(globPatterns(FILE, source)).toEqual([]);
    expect(await listings(source)).toEqual([]);
  });

  it.each([
    ["JSX", "/repo/src/App.tsx", "export const App = () => <div />;"],
    ["an enum, which strip mode refuses", FILE, "enum Kind { A, B }"],
  ])("falls back to the module's own folder, recursively, for %s", async (_, file, rest) => {
    const source = `const p = import.meta.glob("./pages/*.ts");\n${rest}\n`;
    expect(globPatterns(file, source)).toBeNull();
    expect(await listings(source, file)).toEqual([{ directory: "/repo/src", recursive: true }]);
  });
});
