import { SCRIPT } from "./discover.js";

/*
 * Spec 021 D22.2 (row 021-36): `squeal ps` lists the store processes, one
 * per clone and store file: `node <squeal> store-process <common dir>
 * --store code`. A store process is no daemon's child (it is started
 * detached and outlives the daemon that started it), so it is read from
 * the process table by its command line.
 */

/** One store process. */
export interface PsStoreProcess {
  readonly pid: number;
  /** The store file it writes: `code` for `code.sqlite`. */
  readonly file: string;
  /** The clone's common dir from its command line; `null` when it names none. */
  readonly commonDir: string | null;
}

/**
 * The store process whose arguments are `args`; `null` for any other
 * process. Discovery asks it of each process it reads the command line of.
 */
export function storeProcessOf(pid: number, args: readonly string[]): PsStoreProcess | null {
  const at = args.indexOf("store-process");
  if (at < 1 || !SCRIPT.test(args[at - 1] ?? "")) return null;
  const flag = args.indexOf("--store", at);
  return {
    pid,
    file: flag < 0 ? "code" : (args[flag + 1] ?? "code"),
    commonDir: args[at + 1] ?? null,
  };
}

/** The lines `squeal ps` shows for them; none with none. */
export function storeProcessLines(stores: readonly PsStoreProcess[]): string[] {
  if (stores.length === 0) return [];
  return [
    "",
    "Store processes",
    ...stores.map((s) => `  ${s.pid}  ${s.file}.sqlite of ${s.commonDir ?? "an unknown clone"}`),
  ];
}
