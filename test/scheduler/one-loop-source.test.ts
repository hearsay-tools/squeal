import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

/*
 * Rows 011-362 and 011-364 (quality `2026-11-15-card-7.md` S1, R1): the
 * scheduler builds its one wake loop and its one clock, and every owner
 * takes them; none runs a loop of its own or reads the host's clock. So no
 * source but `scheduler.ts` makes a `Wakes`, and none but `clock.ts` names
 * the host adapters. Types are stripped with esbuild and the code parsed
 * with acorn, so comments, strings and type positions are not read.
 */

const SRC = join(import.meta.dirname, "../../src");

/** The one place each may appear, relative to `src`. */
const WAKES_HOME = "core/scheduler/scheduler.ts";
const CLOCK_HOME = "core/scheduler/clock.ts";
const HOST_CLOCK = new Set(["hostNow", "hostClock"]);

/** Sources outside the scheduler that may read the host's clock, each with its reason. */
const HOST_CLOCK_USERS: ReadonlyMap<string, string> = new Map([
  [
    "core/scheduler/daemon-keys.ts",
    "no scheduler on the `ci export` and gate key path: environment records stamp the host's time",
  ],
]);

type Node = { type: string; [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof (value as Node).type === "string";

function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) for (const item of node) walk(item, visit);
  if (!isNode(node)) return;
  visit(node);
  for (const [key, value] of Object.entries(node)) if (key !== "type") walk(value, visit);
}

/** What `file` (relative to `src`) does that only the scheduler or the clock may. */
function offences(file: string, source: string): string[] {
  // Only a source that names one of them can offend: the others are not parsed.
  if (!/Wakes|hostNow|hostClock/.test(source)) return [];
  const { code } = transformSync(source, { loader: "ts", target: "esnext" });
  const found: string[] = [];
  walk(parse(code, { ecmaVersion: "latest", sourceType: "module" }), (node) => {
    const callee = node.callee as Node | undefined;
    if (
      node.type === "NewExpression" &&
      callee?.type === "Identifier" &&
      callee.name === "Wakes" &&
      file !== WAKES_HOME
    )
      found.push(`${file}: new Wakes(`);
    if (
      node.type === "Identifier" &&
      HOST_CLOCK.has(String(node.name)) &&
      file !== CLOCK_HOME &&
      !HOST_CLOCK_USERS.has(file)
    )
      found.push(`${file}: ${String(node.name)}`);
  });
  return [...new Set(found)].sort();
}

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter(
      (entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("one wake loop and one clock (rows 011-362, 011-364)", () => {
  it("no source but the scheduler makes a wake loop, and none but the clock names the host's", () => {
    const found = sources(SRC).flatMap((path) =>
      offences(relative(SRC, path), readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("fails on a planted fallback loop or host clock", () => {
    const planted = [
      'import { hostClock, hostNow } from "./clock.js";',
      "class Owner {",
      "  constructor(options: { wakes?: Wakes; now?: () => number }) {",
      "    const wakes = options.wakes ?? new Wakes(hostClock(options.now));",
      "    this.now = options.now ?? hostNow;",
      "  }",
      "}",
    ].join("\n");
    expect(offences("core/scheduler/owner.ts", planted)).toEqual([
      "core/scheduler/owner.ts: hostClock",
      "core/scheduler/owner.ts: hostNow",
      "core/scheduler/owner.ts: new Wakes(",
    ]);
    // A comment or a type does not count; the scheduler and the clock may.
    expect(
      offences("core/scheduler/owner.ts", "/** hostNow */ let w: Wakes | null = null;"),
    ).toEqual([]);
    expect(offences(WAKES_HOME, "const w = new Wakes(clock);")).toEqual([]);
    expect(offences(CLOCK_HOME, "export const hostNow = () => Date.now();")).toEqual([]);
    expect(offences("core/scheduler/daemon-keys.ts", "keys({ now: hostNow });")).toEqual([]);
  });
});
