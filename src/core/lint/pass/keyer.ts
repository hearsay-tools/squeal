import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../hash/index.js";
import type { AbsolutePath, CheckKey, FileHash, RelativePath } from "../../types/index.js";
import { type BlobOf, holdsBlob, type KeyBasis, lintKey, programSegment } from "./keys.js";
import type { LintFileInputs, LintProvider } from "./provider.js";
import type { LintSource, LintSourceFile as SourceFile } from "./types.js";

/** A file ESLint lints, keyed at its blob now (D5). */
export interface Keyed {
  readonly blob: FileHash;
  readonly key: CheckKey;
  readonly wholeProgram: boolean;
}

/** Where the worktree's files are on disk, for program files outside the listing. */
export interface KeyerDisk {
  readonly root: AbsolutePath;
  readonly format: ObjectFormat;
}

/**
 * One pass's keys. Blobs are read once from the stat cache; each path's
 * inputs are asked of the provider once, and a path it does not lint has
 * none. The program segment is built once, when a whole-program file is
 * keyed, over one listing (D5 as amended for review 0.1.348 B1).
 */
export class Keyer {
  readonly blobOf: BlobOf;
  readonly #blobs = new Map<RelativePath, FileHash | null>();
  readonly #inputs = new Map<RelativePath, LintFileInputs | null>();
  #extensions: ReadonlySet<string>;
  #listing: readonly SourceFile[] | null = null;
  #listed: ReadonlySet<RelativePath> = new Set();
  #segment: string | null = null;
  #program: ReadonlySet<RelativePath> | null = null;

  constructor(
    readonly basis: KeyBasis,
    readonly provider: LintProvider,
    private readonly source: Pick<LintSource, "file" | "files">,
    private readonly disk: KeyerDisk,
    extensions: ReadonlySet<string>,
  ) {
    this.#extensions = extensions;
    this.blobOf = (path) => {
      let blob = this.#blobs.get(path);
      if (blob === undefined && this.#listing === null) {
        blob = source.file(path)?.hash ?? null;
        this.#blobs.set(path, blob);
      }
      return blob ?? null;
    };
  }

  /** The extensions ESLint lints beside the module ones; the segment is built over them again. */
  get extensions(): ReadonlySet<string> {
    return this.#extensions;
  }

  setExtensions(extensions: ReadonlySet<string>): void {
    const same =
      extensions.size === this.#extensions.size &&
      [...extensions].every((ext) => this.#extensions.has(ext));
    this.#extensions = extensions;
    if (!same) this.#segment = null;
  }

  /** D5's program segment, with every blob read in one listing. */
  get segment(): string {
    if (this.#segment !== null) return this.#segment;
    this.#segment = programSegment({
      listing: this.#list(),
      program: this.basis.snapshot.program,
      extensions: this.#extensions,
      installed: this.basis.installed,
      outside: (path) => this.#onDisk(path),
    });
    return this.#segment;
  }

  /**
   * Whether the segment holds `path`'s bytes already: a program file, or a
   * listed file with a module extension or one ESLint lints. A lint report
   * that names a file it does not hold changes the whole-program keys (B3).
   */
  holds(path: RelativePath): boolean {
    this.#program ??= new Set(this.basis.snapshot.program);
    if (this.#program.has(path)) return true;
    this.#list();
    return this.#listed.has(path) && holdsBlob(path, this.#extensions);
  }

  #list(): readonly SourceFile[] {
    if (this.#listing !== null) return this.#listing;
    this.#blobs.clear();
    const listing = this.source.files();
    for (const file of listing) this.#blobs.set(file.path, file.hash);
    this.#listing = listing;
    this.#listed = new Set(listing.map((f) => f.path));
    return listing;
  }

  #onDisk(path: RelativePath): FileHash | null {
    try {
      return blobHash(readFileSync(join(this.disk.root, path)), this.disk.format) as FileHash;
    } catch {
      return null;
    }
  }

  /** The inputs of those of `paths` ESLint lints. Rejects as `provider.inputs` does (D9). */
  async inputs(paths: readonly RelativePath[]): Promise<Map<RelativePath, LintFileInputs>> {
    const missing = paths.filter((p) => !this.#inputs.has(p) && this.blobOf(p) !== null);
    if (missing.length > 0) {
      const given = await this.provider.inputs(missing);
      for (const path of missing) this.#inputs.set(path, given.get(path) ?? null);
    }
    const known = new Map<RelativePath, LintFileInputs>();
    for (const path of paths) {
      const inputs = this.#inputs.get(path);
      if (inputs) known.set(path, inputs);
    }
    return known;
  }

  /** The keys of those of `paths` ESLint lints and that have a file now. */
  async keys(paths: readonly RelativePath[]): Promise<Map<RelativePath, Keyed>> {
    const keyed = new Map<RelativePath, Keyed>();
    for (const [path, inputs] of await this.inputs(paths)) {
      const blob = this.blobOf(path);
      if (blob === null) continue;
      const segment = inputs.wholeProgram ? this.segment : "";
      const key = lintKey(path, inputs, this.basis, this.blobOf, segment);
      keyed.set(path, { blob, key, wholeProgram: inputs.wholeProgram });
    }
    return keyed;
  }
}
