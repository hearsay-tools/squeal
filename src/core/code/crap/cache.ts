import { createHash } from "node:crypto";
import { compare } from "../../fs/index.js";
import type { CodeFile } from "../../types/code.js";
import type { CheckKey, EpochMs, RelativePath } from "../../types/index.js";
import { COVERAGE_PROVIDER_VERSION, decodeRecord } from "../coverage/record.js";
import type { CoverageRecord } from "../coverage/types.js";
import type { CodeCoverageRepo } from "../store/types.js";
import { type FileCondition, fileCondition } from "./file.js";
import type { LoaderBuild, Loaders } from "./loaders.js";

/**
 * Row 015-42 (011-197): what a chain of coverage steps keeps, so a step
 * past its budget does not read and decode it all again. The loader map,
 * with each source's condition and signature from it, holds while keys and
 * results stay: the code pass drops it when results, records, a revision
 * or a wake may change it (`invalidate`), and a map still being read starts
 * again (row 015-45). A decoded record holds for the chain while its key
 * keeps its bytes: a later run at a key stores its record over the first
 * (review 0.1.305 B1), so after `invalidate` each is read again, and
 * decoded again only when its bytes moved. They go once a step ends the
 * chain (`settle`), so they hold no memory between chains.
 */
export class StepCache {
  #loaders: Loaders | null = null;
  /** The loader map being read, a test file at a time (row 015-45). */
  #build: LoaderBuild | null = null;
  readonly #conditions = new Map<RelativePath, FileCondition>();
  /** By path: the signature, and the blob, counter version and threshold it was made at. */
  readonly #signatures = new Map<RelativePath, { readonly at: string; readonly value: string }>();
  readonly #records = new Map<CheckKey, Decoded>();
  /** Counts `invalidate`: a record decoded before the last one is read again. */
  #epoch = 0;

  /**
   * The loader map, read once while it holds, as far as `work` allows at
   * each call (row 015-45); `null` until it is whole.
   */
  loaders(start: () => LoaderBuild, work: () => boolean): Loaders | null {
    if (this.#loaders !== null) return this.#loaders;
    this.#build ??= start();
    this.#loaders = this.#build.advance(work);
    if (this.#loaders !== null) this.#build = null;
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

  /**
   * `signatureOf`, made again only when the file's blob or counter version
   * or the threshold moves, or after `invalidate`, which a stored record
   * calls.
   */
  signature(
    file: Pick<CodeFile, "path" | "blob" | "counterVersion">,
    threshold: number,
    loaders: readonly SignedLoader[],
  ): string {
    const at = `${file.blob}\0${file.counterVersion}\0${threshold}`;
    const known = this.#signatures.get(file.path);
    if (known?.at === at) return known.value;
    const value = signatureOf(file, threshold, loaders);
    this.#signatures.set(file.path, { at, value });
    return value;
  }

  /** The record at `key`, decoded once in a chain while its bytes stay; `null` when the store holds none. */
  record(coverage: Pick<CodeCoverageRepo, "get">, key: CheckKey): CoverageRecord | null {
    const known = this.#records.get(key);
    if (known?.epoch === this.#epoch) return known.record;
    const bytes = coverage.get({ resultKey: key, providerVersion: COVERAGE_PROVIDER_VERSION });
    if (bytes === null) {
      this.#records.delete(key);
      return null;
    }
    const digest = createHash("sha1").update(bytes).digest("hex");
    const record = known?.digest === digest ? known.record : decodeRecord(bytes);
    this.#records.set(key, { digest, record, epoch: this.#epoch });
    return record;
  }

  /** Decodes the records of `keys`, one each time `work` allows; false while some are left. */
  decode(
    coverage: Pick<CodeCoverageRepo, "get">,
    keys: readonly CheckKey[],
    work: () => boolean,
  ): boolean {
    for (const key of keys) {
      if (this.#records.get(key)?.epoch === this.#epoch) continue;
      if (!work()) return false;
      this.record(coverage, key);
    }
    return true;
  }

  invalidate(): void {
    this.#loaders = null;
    this.#build = null;
    this.#conditions.clear();
    this.#signatures.clear();
    this.#epoch++;
  }

  settle(): void {
    this.#records.clear();
  }
}

/** A decoded record, the hash of the bytes it was decoded from, and the `invalidate` count it was read at. */
interface Decoded {
  readonly digest: string;
  readonly record: CoverageRecord;
  readonly epoch: number;
}

/** A ready loader as a signature reads it: its key, and when its record was stored. */
type SignedLoader = { readonly key: CheckKey; readonly storedAt: EpochMs };

/**
 * What a judgement read, hashed so the summary stays small: the blob, the
 * counter version its CC is from, `crap.threshold` (review 0.1.297 B1 and
 * B2), and its loaders' keys, each with when its record was stored, so a
 * record stored again at a key judges again (row 015-44).
 */
export function signatureOf(
  file: Pick<CodeFile, "blob" | "counterVersion">,
  threshold: number,
  loaders: readonly SignedLoader[],
): string {
  const records = loaders.map((l) => `${l.key} ${l.storedAt}`).sort(compare);
  return createHash("sha1")
    .update(
      [file.blob, `counter ${file.counterVersion}`, `crap ${threshold}`, ...records].join("\n"),
    )
    .digest("hex");
}
