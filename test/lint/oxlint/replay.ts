import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RelativePath } from "../../../src/core/types/index.js";
import { OXLINT_PACKAGE } from "./helpers.js";

/*
 * The 017-12 probe's replay fixture and edits (`research/probes/oxlint-provider/
 * replay.mjs`), as data: a root config extending `configs/base.json`, a nested
 * `pkg/` config, an import cycle, `import/named` targets in the project and in
 * an installed package, and in mode C a JS plugin that imports `helper.mjs`
 * and reads `banned.txt`. Modes B and D (type-aware) are off in the first
 * version (D11).
 */

export type Mode = "A" | "C";

export const FIXTURE: Readonly<Record<string, string>> = {
  ".eslintignore": "",
  ".gitignore": "node_modules\n",
  "banned.txt": "forbidden\n",
  "configs/base.json": '{\n  "rules": { "eqeqeq": "error" }\n}\n',
  "gen/g.ts": "const gUnused = 1;\n",
  "package.json": '{ "name": "oxlint-probe-fixture", "private": true, "type": "module" }\n',
  "pkg/.oxlintrc.json":
    '{\n  "extends": ["../configs/base.json"],\n  "plugins": ["typescript"],\n  "rules": { "no-debugger": "error" }\n}\n',
  "pkg/p.ts": "export function p(x: number): boolean {\n  return x == 1;\n}\n",
  "pkg/sub/q.ts": "export const q = (x: number): boolean => x == 2;\n",
  "plugins/helper.mjs": 'export const BANNED_IDENT = "foo";\n',
  "plugins/local.mjs": `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BANNED_IDENT } from "./helper.mjs";

export default {
  meta: { name: "local" },
  rules: {
    "no-ident": {
      create(context) {
        return {
          Identifier(node) {
            if (node.name === BANNED_IDENT) context.report({ node, message: \`Identifier '\${BANNED_IDENT}' is banned.\` });
          },
        };
      },
    },
    "no-word": {
      create(context) {
        const words = readFileSync(join(context.cwd, "banned.txt"), "utf8").split("\\n").map((w) => w.trim()).filter(Boolean);
        return {
          Literal(node) {
            if (typeof node.value === "string" && words.includes(node.value)) context.report({ node, message: \`String '\${node.value}' is banned.\` });
          },
        };
      },
    },
  },
};
`,
  "node_modules/probe-dep/index.d.ts": "export declare const val: number;\n",
  "node_modules/probe-dep/index.js": "export const val = 1;\n",
  "node_modules/probe-dep/package.json":
    '{ "name": "probe-dep", "version": "1.0.0", "type": "module", "main": "index.js", "types": "index.d.ts" }\n',
  "src/a.ts":
    'import { greet } from "./b.js";\n\nexport function main(): string {\n  const unused = 1;\n  return greet("x");\n}\n',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture's source text
  "src/b.ts": "export function greet(name: string): string {\n  return `hi ${name}`;\n}\n",
  "src/c.ts": 'import { d } from "./d.js";\n\nexport const c = (): number => d() + 1;\n',
  "src/d.ts": "export const d = (): number => 1;\n",
  "src/e.js": 'import { val } from "probe-dep";\n\nexport const e = val;\n',
  "src/m.js": 'import { nval } from "./n.js";\n\nexport const m = nval;\n',
  "src/n.js": "export const nval = 1;\n",
  "src/t.ts": 'import { load } from "./u.js";\n\nexport function run(): void {\n  load();\n}\n',
  "src/u.ts": "export function load(): number {\n  return 1;\n}\n",
  "src/w.ts": 'export const word = "allowed";\nexport const foo = 1;\n',
  "tsconfig.json":
    '{\n  "compilerOptions": { "target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "noEmit": true },\n  "include": ["src", "pkg"]\n}\n',
};

/** One edit: its category, its weight in the seeded picks, and what it does to the project. */
export interface Edit {
  readonly category: string;
  readonly weight: number;
  readonly name: string;
  readonly apply: () => void;
}

/** The probe's edits for one mode, over the project at `root`. */
export function edits(mode: Mode, root: string): { edits: readonly Edit[]; start: () => void } {
  const jsPlugins = mode === "C";
  const S: Record<string, boolean> = {};
  const w = (rel: string, text: string) => writeFileSync(join(root, rel), text);
  const rm = (rel: string) => rmSync(join(root, rel), { force: true });
  const toggle = (k: string) => {
    S[k] = !S[k];
    return S[k];
  };
  const json = (o: unknown) => `${JSON.stringify(o, null, 2)}\n`;
  const rootConfig = () => ({
    extends: ["./configs/base.json"],
    plugins: ["eslint", "typescript", "import"],
    ...(jsPlugins ? { jsPlugins: ["./plugins/local.mjs"] } : {}),
    ignorePatterns: ["gen/**", ...(S.ignoreC ? ["src/c.ts"] : [])],
    rules: {
      "no-unused-vars": S.unusedWarn ? "warn" : "error",
      "import/named": "error",
      "import/no-cycle": "error",
      ...(jsPlugins ? { "local/no-ident": "error", "local/no-word": "error" } : {}),
    },
  });
  const e = (category: string, weight: number, name: string, apply: () => void): Edit => ({
    category,
    weight,
    name,
    apply,
  });
  const list: Edit[] = [
    e("file", 3, "a.ts unused var", () =>
      w(
        "src/a.ts",
        `import { greet } from "./b.js";\n\nexport function main(): string {\n${toggle("aUnused") ? "" : "  const unused = 1;\n"}  return greet("x");\n}\n`,
      ),
    ),
    e("file", 2, "w.ts identifier", () =>
      w(
        "src/w.ts",
        `export const word = "allowed";\nexport const ${toggle("wBar") ? "bar2" : "foo"} = 1;\n`,
      ),
    ),
    e("import-target", 2, "n.js export renamed (m.js imports it)", () =>
      w("src/n.js", `export const ${toggle("nRen") ? "nval2" : "nval"} = 1;\n`),
    ),
    e("import-graph", 2, "d.ts imports c.ts", () =>
      w(
        "src/d.ts",
        toggle("cycle")
          ? `import { c } from "./c.js";\n\nexport const d = (): number => 1;\nexport const dc = c;\n`
          : "export const d = (): number => 1;\n",
      ),
    ),
    e("installed-package", 1, "probe-dep export renamed", () => {
      const v = toggle("depRen") ? "val2" : "val";
      w("node_modules/probe-dep/index.js", `export const ${v} = 1;\n`);
      w("node_modules/probe-dep/index.d.ts", `export declare const ${v}: number;\n`);
    }),
    e("type-program", 2, "u.ts returns a Promise", () =>
      w(
        "src/u.ts",
        toggle("uPromise")
          ? "export async function load(): Promise<number> {\n  return 1;\n}\n"
          : "export function load(): number {\n  return 1;\n}\n",
      ),
    ),
    e("tsconfig", 1, "tsconfig strict and exclude t.ts", () => {
      const t = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8"));
      if (toggle("tsEx")) t.exclude = ["src/t.ts"];
      else delete t.exclude;
      w("tsconfig.json", json(t));
    }),
    e("extends", 1, "base.json eqeqeq", () =>
      w("configs/base.json", json({ rules: { eqeqeq: toggle("eqOff") ? "off" : "error" } })),
    ),
    e("root-config", 1, "root no-unused-vars severity", () => {
      toggle("unusedWarn");
      w(".oxlintrc.json", json(rootConfig()));
    }),
    e("nested-config", 1, "pkg config overrides eqeqeq", () =>
      w(
        "pkg/.oxlintrc.json",
        json({
          extends: ["../configs/base.json"],
          plugins: ["typescript"],
          rules: { "no-debugger": "error", ...(toggle("pkgEqOff") ? { eqeqeq: "off" } : {}) },
        }),
      ),
    ),
    e("nested-new", 1, "pkg/sub config appears", () =>
      toggle("subCfg")
        ? w("pkg/sub/.oxlintrc.json", json({ rules: { eqeqeq: "off" } }))
        : rm("pkg/sub/.oxlintrc.json"),
    ),
    e("ignore-file", 1, ".eslintignore lists w.ts", () =>
      w(".eslintignore", toggle("ignW") ? "src/w.ts\n" : ""),
    ),
    e("ignore-pattern", 1, "ignorePatterns lists c.ts", () => {
      toggle("ignoreC");
      w(".oxlintrc.json", json(rootConfig()));
    }),
    e("suppressions", 1, "oxlint-suppressions.json for a.ts", () =>
      toggle("supp")
        ? w("oxlint-suppressions.json", json({ "src/a.ts": { "no-unused-vars": { count: 1 } } }))
        : rm("oxlint-suppressions.json"),
    ),
  ];
  if (jsPlugins) {
    list.push(
      e("js-import", 1, "plugin helper bans another name", () =>
        w(
          "plugins/helper.mjs",
          `export const BANNED_IDENT = "${toggle("helperBar") ? "bar2" : "foo"}";\n`,
        ),
      ),
      e("js-read", 1, "banned.txt read by a rule", () =>
        w("banned.txt", toggle("bannedAllowed") ? "allowed\n" : "forbidden\n"),
      ),
      e("js-plugin", 1, "plugin message text", () => {
        const t = readFileSync(join(root, "plugins/local.mjs"), "utf8");
        w(
          "plugins/local.mjs",
          toggle("msg")
            ? t.replace("is banned.`", "is not allowed.`")
            : t.replace("is not allowed.`", "is banned.`"),
        );
      }),
    );
  }
  return { edits: list, start: () => w(".oxlintrc.json", json(rootConfig())) };
}

/** The probe's schedule: each edit three times, then seeded picks up to `steps`, shuffled. */
export function schedule(list: readonly Edit[], steps: number, seed: number): Edit[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const bag = list.flatMap((e) => Array<Edit>(e.weight).fill(e));
  const out: Edit[] = [];
  for (let r = 0; r < 3; r++) out.push(...list);
  while (out.length < steps) out.push(bag[Math.floor(rand() * bag.length)] as Edit);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j] as Edit, out[i] as Edit];
  }
  return out;
}

/** Every file but `node_modules` and `.git`: what git would list, the fixture ignoring only `node_modules`. */
export function listing(root: string, dir = ""): RelativePath[] {
  const out: RelativePath[] = [];
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== ".git") out.push(...listing(root, rel));
    } else out.push(rel as RelativePath);
  }
  return out.sort();
}

/** The truth: a fresh whole run, and which files a whole walk lints; a file's result as one string. */
export function truth(root: string, files: readonly RelativePath[]): Map<RelativePath, string> {
  const run = (args: string[]) =>
    spawnSync(process.execPath, [join(OXLINT_PACKAGE, "bin/oxlint"), "--threads", "1", ...args], {
      cwd: root,
      env: { PATH: process.env.PATH },
      encoding: "utf8",
    }).stdout;
  const linted = new Set(
    run(["--debug", "files"])
      .split("\n")
      .map((l) => l.trim()),
  );
  const report = JSON.parse(run(["--format", "json"])) as {
    diagnostics: {
      code?: string;
      severity: string;
      message: string;
      filename: string;
      labels?: { span: { line: number; column: number } }[];
    }[];
  };
  const by = new Map<string, string[]>();
  for (const d of report.diagnostics) {
    const span = d.labels?.[0]?.span;
    const list = by.get(d.filename) ?? [];
    list.push(
      `${d.code ?? null}|${d.severity}|${d.message}|${span?.line ?? 0}:${span?.column ?? 0}`,
    );
    by.set(d.filename, list);
  }
  return new Map(
    files.map((f) => [f, linted.has(f) ? JSON.stringify((by.get(f) ?? []).sort()) : "ignored"]),
  );
}
