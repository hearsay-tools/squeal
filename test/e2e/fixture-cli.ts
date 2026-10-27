import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CLI = "dist/cli/squeal.mjs";
const VERSION = /^\d+\.\d+\.\d+$/;
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One fixture's CLI paths, also after its files are removed during cleanup. */
export class FixtureCli {
  constructor(
    readonly plugin: string,
    readonly data?: string,
  ) {}

  /** Claude's bundled CLI, or Codex's selected runtime with the seed before bootstrap. */
  get path(): string {
    if (this.data === undefined) return join(this.plugin, CLI);
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

  /** Exact CLI and command arguments in either /proc's NULs or ps's spaces. */
  matches(args: string, command: string, separator: "\0" | " " = " "): boolean {
    const paths =
      this.data === undefined
        ? [escapeRegex(join(this.plugin, CLI))]
        : [
            escapeRegex(join(this.plugin, "seed", CLI)),
            `${escapeRegex(join(this.data, "versions"))}/\\d+\\.\\d+\\.\\d+/${escapeRegex(CLI)}`,
          ];
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
