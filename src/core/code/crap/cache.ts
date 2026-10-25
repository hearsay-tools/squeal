import { createHash } from "node:crypto";
import { compare } from "../../fs/index.js";
import type { CodeFile } from "../../types/code.js";
import type { CheckKey, RelativePath } from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../coverage/record.js";
import type { CoverageRecord } from "../coverage/types.js";
import type { CodeCoverageRepo } from "../store/types.js";
import { type FileCondition, fileCondition } from "./file.js";
import type { Loaders } from "./loaders.js";

/**
 * Row 015-42 (011-197): what a chain of coverage steps keeps, so a step
 * past its budget does not read and decode it all again. The loader map,
 * with each source's condition and signature from it, holds while keys and
 * results stay: the code pass drops it when results, records, a revision
 * or a wake may change it (`invalidate`). The decoded records hold for the
 * chain, since a record at a key stays the record of those bytes; they go
 * once a step ends the chain (`settle`), so they hold no memory between
 * chains.
 */
export class StepCache {
  #loaders: Loaders | null = null;
  readonly #conditions = new Map<RelativePath, FileCondition>();
  /** By path: the signature, and the blob, counter version and threshold it was made at. */
  readonly #signatures = new Map<RelativePath, { readonly at: string; readonly value: string }>();
  readonly #records = new Map<CheckKey, CoverageRecord>();

  /** The loader map, read once while it holds. */
  loaders(read: () => Loaders): Loaders {
    this.#loaders ??= read();
    return this.#loaders;
  }

  /** A source's condition from the loader map. */
  condition(path: RelativePath, loaders: Loaders): FileCondition {
    const known = this.#conditions.get(path);
    if (known !== undefined) return known;
    const condition = fileCondition(loaders.of(path), loaders.listed);
    this.#conditions.set(path, condition);
    return condition;
  }

  /** `signatureOf`, made again only when the file's blob or counter version or the threshold moves. */
  signature(
    file: Pick<CodeFile, "path" | "blob" | "counterVersion">,
    threshold: number,
    loaders: readonly { readonly key: CheckKey }[],
  ): string {
    const at = `${file.blob}\0${file.counterVersion}\0${threshold}`;
    const known = this.#signatures.get(file.path);
    if (known?.at === at) return known.value;
    const value = signatureOf(file, threshold, loaders);
    this.#signatures.set(file.path, { at, value });
    return value;
  }

  /** The record at `key`, decoded once in a chain; `null` when the store holds none. */
  record(coverage: Pick<CodeCoverageRepo, "get">, key: CheckKey): CoverageRecord | null {
    const known = this.#records.get(key);
    if (known !== undefined) return known;
    const bytes = coverage.get({ resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION });
    if (bytes === null) return null;
    const record = decodeRecord(bytes);
    this.#records.set(key, record);
    return record;
  }

  /** Decodes the records of `keys`, one each time `work` allows; false while some are left. */
  decode(
    coverage: Pick<CodeCoverageRepo, "get">,
    keys: readonly CheckKey[],
    work: () => boolean,
  ): boolean {
    for (const key of keys) {
      if (this.#records.has(key)) continue;
      if (!work()) return false;
      this.record(coverage, key);
    }
    return true;
  }

  invalidate(): void {
    this.#loaders = null;
    this.#conditions.clear();
    this.#signatures.clear();
  }

  settle(): void {
    this.#records.clear();
  }
}

/**
 * What a judgement read, hashed so the summary stays small: the blob, the
 * counter version its CC is from, `crap.threshold` (review 0.1.297 B1 and
 * B2) and its loaders' keys.
 */
export function signatureOf(
  file: Pick<CodeFile, "blob" | "counterVersion">,
  threshold: number,
  loaders: readonly { readonly key: CheckKey }[],
): string {
  const keys = loaders.map((l) => l.key).sort(compare);
  return createHash("sha1")
    .update([file.blob, `counter ${file.counterVersion}`, `crap ${threshold}`, ...keys].join("\n"))
    .digest("hex");
}
