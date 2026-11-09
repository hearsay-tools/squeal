import { isClosurePath } from "../keys/closure.js";
import { testFileId } from "../keys/reverse-index.js";
import type { RelativePath } from "../types/common.js";
import type { TestFileRef } from "../types/keys.js";

/** Names the observed paths a key leaves out; bumped when that encoding changes. */
const REFUSED_OBSERVED = "squeal-refused-observed/1";

/**
 * Row 011-310 (issue #166): the stored observed paths closure assembly cannot
 * take (`isClosurePath`), such as `\home\...` from a test that fakes win32.
 * The shared set keeps them (011 C3: never pruned); `effectiveObserved`
 * leaves them out of the closure, so the key names them instead. The key then
 * differs from the key over the valid paths alone, and a result stored
 * before one was observed is not current. Each test file's are noted once per
 * change, and not at the first sight when an earlier daemon of the worktree
 * noted the same.
 */
export class RefusedObserved {
  /** Per test file, the note last given; `null` once its refused paths are gone. */
  readonly #noted = new Map<string, string | null>();

  constructor(
    private readonly note: (text: string) => void,
    private readonly persisted: (text: string) => boolean,
  ) {}

  /** The key's runtime part `runtime`, with the paths of `raw` refused for `ref`; as given when none is. */
  keyed(ref: TestFileRef, raw: readonly RelativePath[], runtime: string): string {
    const refused = raw.filter((path) => !isClosurePath(path));
    this.#noteOnce(ref, refused);
    if (refused.length === 0) return runtime;
    return JSON.stringify([REFUSED_OBSERVED, refused, runtime]);
  }

  #noteOnce(ref: TestFileRef, refused: readonly RelativePath[]): void {
    const id = testFileId(ref);
    const text = refused.length === 0 ? null : refusedNote(ref, refused);
    if ((this.#noted.get(id) ?? null) === text) return;
    const first = !this.#noted.has(id);
    this.#noted.set(id, text);
    if (text !== null && !(first && this.persisted(text))) this.note(text);
  }
}

/** The status note naming `ref`'s refused observed paths. */
export function refusedNote(ref: TestFileRef, refused: readonly RelativePath[]): string {
  const paths = refused.map((path) => `"${path}"`).join(", ");
  const one = refused.length === 1;
  const what = one ? "path" : "paths";
  const is = one ? "is not a worktree-relative path" : "are not worktree-relative paths";
  return (
    `observed ${what} left out of ${ref.project}:${ref.path}: ${paths} ${is}; ` +
    `the file's key marks its closure incomplete, so no result stored before the ${what} ` +
    `${one ? "was" : "were"} observed is reused`
  );
}
