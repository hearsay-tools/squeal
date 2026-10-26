import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Research 017-01's 200-edit replay (`research/probes/eslint-provider/`,
 * `warm.mjs` and `mutations.mjs`), on `test/fixtures/lint/project`. Twelve
 * change windows of 16 steps: reset the sources, apply one input change,
 * five edits, revert it. The other steps edit one source file each.
 */

export const SOURCES = ["src/a.js", "src/b.js", "src/t.ts", "src/u.ts"];

export interface Step {
  readonly what: string;
  /** The paths the step wrote, relative to the root. */
  readonly changed: readonly string[];
}

interface Change {
  readonly id: string;
  readonly path: string;
  /** `from` replaced by `to`; with no `from`, the file is created with `to` and deleted on revert. */
  readonly from?: string;
  readonly to: string;
}

const PROMISE_FROM = "export function load(): number {\n  return 1;";
const PROMISE_TO = "export function load(): Promise<number> {\n  return Promise.resolve(1);";

const CHANGES: readonly Change[] = [
  { id: "file-edit", path: "src/a.js", from: "let y", to: "const y" },
  {
    id: "config-file",
    path: "eslint.config.js",
    from: '"import-x/named": "error"',
    to: '"import-x/named": "error", "id-length": ["error", { min: 2 }]',
  },
  {
    id: "config-import",
    path: "eslint/local.js",
    from: '"prefer-const": "error"',
    to: '"prefer-const": "off"',
  },
  {
    id: "local-rule-code",
    path: "eslint/rules/no-foo.js",
    from: 'node.name === "foo"',
    to: 'node.name === "foo" || node.name === "y"',
  },
  {
    id: "shareable-config",
    path: "node_modules/eslint-config-probe/index.js",
    from: '"no-console": "error"',
    to: '"no-console": "error", "id-length": ["error", { min: 2 }]',
  },
  {
    id: "plugin-code",
    path: "node_modules/eslint-plugin-probe/index.js",
    from: "  create(context) {\n    return {",
    to: '  create(context) {\n    context.report({ loc: { line: 1, column: 0 }, message: "probe: plugin code changed" });\n    return {',
  },
  {
    id: "plugin-version",
    path: "node_modules/eslint-plugin-probe/package.json",
    from: '"version": "1.0.0"',
    to: '"version": "1.0.1"',
  },
  { id: "import-target", path: "src/b.js", from: "export const x", to: "export const w" },
  { id: "typed-program", path: "src/u.ts", from: PROMISE_FROM, to: PROMISE_TO },
  {
    id: "tsconfig",
    path: "tsconfig.json",
    from: '"include": ["src/**/*.ts"]',
    to: '"include": ["src/**/*.ts"], "exclude": ["src/t.ts"]',
  },
  {
    id: "ignores",
    path: "eslint.config.js",
    from: '"eslint.config.js"]',
    to: '"eslint.config.js", "src/a.js"]',
  },
  {
    id: "nested-config",
    path: "src/eslint.config.js",
    to: 'export default [{ rules: { "no-console": "error" } }];\n',
  },
];

/** Applies step `step` of the replay to the project at `root`. */
export class Replay {
  private readonly base: ReadonlyMap<string, string>;
  private readonly before = new Map<string, string>();

  constructor(private readonly root: string) {
    this.base = new Map(SOURCES.map((p) => [p, this.read(p)]));
  }

  step(step: number): Step {
    const k = Math.floor(step / 16);
    const phase = step % 16;
    const change = CHANGES[k];
    if (change === undefined || phase < 4 || phase > 11) return this.plain(step);
    if (phase === 4) {
      for (const [path, text] of this.base) this.write(path, text);
      return { what: "reset the sources", changed: SOURCES };
    }
    if (phase === 5) return this.apply(change);
    if (phase === 11) return this.revert(change);
    this.write("src/t.ts", `${this.base.get("src/t.ts")}// window ${step}\n`);
    return { what: "src/t.ts comment", changed: ["src/t.ts"] };
  }

  /** Undoes an open window and resets the sources. */
  finish(): void {
    for (const change of CHANGES) if (this.before.has(change.id)) this.revert(change);
    for (const [path, text] of this.base) this.write(path, text);
  }

  private plain(step: number): Step {
    const path = SOURCES[step % 4] ?? "src/a.js";
    const variant = Math.floor(step / 4) % 3;
    let text = this.base.get(path) ?? "";
    if (variant === 1 && path === "src/a.js") text = text.replace("let y", "const y");
    if (variant === 1 && path === "src/b.js")
      text = text.replace("export const x", "export const w");
    if (variant === 1 && path === "src/u.ts") text = text.replace(PROMISE_FROM, PROMISE_TO);
    if (variant === 2) text += `// step ${step}\n`;
    this.write(path, text);
    return { what: `${path} v${variant}`, changed: [path] };
  }

  private apply(change: Change): Step {
    const path = join(this.root, change.path);
    const before = existsSync(path) ? this.read(change.path) : "";
    this.before.set(change.id, before);
    if (change.from === undefined) this.write(change.path, change.to);
    else {
      if (!before.includes(change.from)) throw new Error(`${change.path}: no "${change.from}"`);
      this.write(change.path, before.replace(change.from, change.to));
    }
    return { what: `apply ${change.id}`, changed: [change.path] };
  }

  private revert(change: Change): Step {
    const before = this.before.get(change.id) ?? "";
    this.before.delete(change.id);
    if (change.from === undefined) rmSync(join(this.root, change.path), { force: true });
    else this.write(change.path, before);
    return { what: `revert ${change.id}`, changed: [change.path] };
  }

  private read(path: string): string {
    return readFileSync(join(this.root, path), "utf8");
  }

  private write(path: string, text: string): void {
    writeFileSync(join(this.root, path), text);
  }
}
