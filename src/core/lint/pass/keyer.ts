import type { CheckKey, FileHash, RelativePath } from "../../types/index.js";
import { type BlobOf, type KeyBasis, lintKey, programSegment } from "./keys.js";
import type { LintFileInputs, LintProvider } from "./provider.js";
import type { LintSource } from "./types.js";

/** A file ESLint lints, keyed at its blob now (D5). */
export interface Keyed {
  readonly blob: FileHash;
  readonly key: CheckKey;
  readonly wholeProgram: boolean;
}

/**
 * One pass's keys. Blobs are read once from the stat cache; each path's
 * inputs are asked of the provider once, and a path it does not lint has
 * none. The program segment is built once, when a whole-program file is
 * keyed (D5 as amended 2026-10-26): the provider's program files and every
 * file ESLint lints in the worktree, `lintable`.
 */
export class Keyer {
  readonly blobOf: BlobOf;
  readonly #blobs = new Map<RelativePath, FileHash | null>();
  readonly #inputs = new Map<RelativePath, LintFileInputs | null>();
  #lintable: () => Iterable<RelativePath>;
  #segment: string | null = null;
  #listed = false;

  constructor(
    readonly basis: KeyBasis,
    readonly provider: LintProvider,
    private readonly source: Pick<LintSource, "file" | "files">,
    lintable: () => Iterable<RelativePath>,
  ) {
    this.#lintable = lintable;
    this.blobOf = (path) => {
      let blob = this.#blobs.get(path);
      if (blob === undefined && !this.#listed) {
        blob = source.file(path)?.hash ?? null;
        this.#blobs.set(path, blob);
      }
      return blob ?? null;
    };
  }

  /** The files ESLint lints in the worktree now, read when needed; the segment is built over them again. */
  setLintable(lintable: () => Iterable<RelativePath>): void {
    this.#lintable = lintable;
    this.#segment = null;
  }

  /** D5's program segment, with every blob read in one listing. */
  get segment(): string {
    if (this.#segment !== null) return this.#segment;
    if (!this.#listed) {
      this.#blobs.clear();
      for (const file of this.source.files()) this.#blobs.set(file.path, file.hash);
      this.#listed = true;
    }
    const program = [...this.basis.snapshot.program, ...this.#lintable()];
    this.#segment = programSegment(program, this.blobOf);
    return this.#segment;
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
