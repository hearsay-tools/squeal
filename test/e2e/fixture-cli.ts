import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CLI = "dist/cli/squeal.mjs";
const VERSION = /^\d+\.\d+\.\d+$/;
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Where a plugin's CLI runs from: `runtime`, Codex's selected runtime in its
 * data folder, the plugin's seed before bootstrap (spec 002 D8); `kept`, the
 * plugin's own bundled CLI, and daemons from the version copies a hook keeps
 * in its data folder (spec 024 D1).
 */
export type CliLayout = "runtime" | "kept";

/** One fixture's CLI paths, also after its files are removed during cleanup. */
export class FixtureCli {
  constructor(
    readonly plugin: string,
    readonly data?: string,
    readonly layout: CliLayout = "runtime",
  ) {}

  /**
   * Claude's bundled CLI; Antigravity's, or once its plugin root is gone, the newest
   * kept copy's; or Codex's selected runtime with the seed before bootstrap.
   */
  get path(): string {
    if (this.data === undefined) return join(this.plugin, CLI);
    if (this.layout === "kept") return this.#kept(this.data);
    const current = join(this.data, "runtime/current.json");
    if (!existsSync(current)) return join(this.plugin, "seed", CLI);
    const record = JSON.parse(readFileSync(current, "utf8")) as {
      schema?: unknown;
      version?: unknown;
    };
    if (
      record.schema !== 1 ||
      typeof record.version !== "string" ||
      !VERSION.test(record.version)
    ) {
      throw new Error(`invalid fixture runtime selection: ${current}`);
    }
    return join(this.data, "versions", record.version, CLI);
  }

  /** The plugin's CLI while it exists, else the newest version copy's in `data` (024 D1). */
  #kept(data: string): string {
    const own = join(this.plugin, CLI);
    const versions = join(data, "versions");
    if (existsSync(own) || !existsSync(versions)) return own;
    const newest = readdirSync(versions)
      .filter((v) => VERSION.test(v) && existsSync(join(versions, v, CLI)))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
      .at(-1);
    return newest === undefined ? own : join(versions, newest, CLI);
  }

  /** Exact CLI and command arguments in either /proc's NULs or ps's spaces. */
  matches(args: string, command: string, separator: "\0" | " " = " "): boolean {
    const versions = (data: string) =>
      `${escapeRegex(join(data, "versions"))}/\\d+\\.\\d+\\.\\d+/${escapeRegex(CLI)}`;
    const paths =
      this.data === undefined
        ? [escapeRegex(join(this.plugin, CLI))]
        : this.layout === "kept"
          ? [escapeRegex(join(this.plugin, CLI)), versions(this.data)]
          : [escapeRegex(join(this.plugin, "seed", CLI)), versions(this.data)];
    return new RegExp(
      `(?:^|${separator})(?:${paths.join("|")})${separator}${escapeRegex(command)}(?:${separator}|$)`,
    ).test(args);
  }

  /** Includes older retained runtimes, even after selection changes or fixture removal. */
  pids(command: string): number[] {
    const ps = execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" });
    return ps
      .split("\n")
      .filter((line) => this.matches(line, command))
      .map((line) => Number.parseInt(line.trim(), 10))
      .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
  }
}
