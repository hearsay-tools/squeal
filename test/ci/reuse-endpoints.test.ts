import { describe, expect, it, vi } from "vitest";
import type { NamedPart } from "../../src/core/ci/export-check.js";
import { PART_FORMAT, type Part } from "../../src/core/ci/parts.js";
import { FileReuse, type Holder, type ReuseOptions } from "../../src/core/ci/reuse.js";
import type { AtCommit } from "../../src/core/ci/reuse-endpoints.js";
import { ABSENT_LISTING } from "../../src/core/keys/observed.js";
import { blob, EVIDENCE, part, REF } from "../code/gate/parts-kit.js";

/*
 * Spec 018 D33 (row 018-58): `FileReuse` certifies an input its part holds
 * no read-time evidence of when the part (format 6) hashed it at both ends
 * of the command, nothing touched it, the commit holds it and its hash
 * equals the content here. Parts here are made by hand; the recorder that
 * writes them is row 018-57's.
 */

const COMMIT = "c0ffee";
/** An input no hooked process read: a declared file `cat` reads. */
const DATA = "data/x.txt";
/** A listing no hooked process listed. */
const LISTING = "fixtures/";
const LISTED = blob("listing of fixtures");
const INPUTS = ["src/a.ts", "test/a.test.ts", DATA, LISTING];

/** The commit's tree: every file of the fixture, and the listing of `fixtures/`. */
const TREE: AtCommit = (path) =>
  path === LISTING ? LISTED : path.endsWith("/") ? ABSENT_LISTING : (EVIDENCE[path] ?? null);

/** The content here: the commit's. */
const here = (path: string) => TREE(path);

/** The read-time evidence of a run that read its closure and nothing else. */
const { [DATA]: _data, ...READ } = EVIDENCE;

/** A format 6 part of commit `COMMIT` that hashed its command's ends: nothing differs, nothing touched. */
function hashed(overrides: Partial<Part> = {}): Part {
  const base = part();
  return {
    ...base,
    format: PART_FORMAT,
    header: { ...base.header, commit: COMMIT },
    evidence: READ,
    stable: {},
    touched: [],
    ...overrides,
  };
}

const named = (p: Part): NamedPart[] => [{ file: "part-0.json", part: p }];

/** `ci export`'s option: the parts' commit tree. */
const EXPORT: ReuseOptions = { atCommit: async (commit) => (commit === COMMIT ? TREE : null) };

async function certify(p: Part, options: ReuseOptions = EXPORT, content = here) {
  const reuse = new FileReuse(named(p), options);
  const owner = reuse.owner(REF);
  if (owner === null || "reason" in owner) throw new Error(JSON.stringify(owner));
  return reuse.certify(owner as Holder, INPUTS, content);
}

/** The inputs left out, or `[]` with the inputs the rule certified. */
async function outcome(p: Part, options?: ReuseOptions, content?: typeof here) {
  const { refused, endpoints } = await certify(p, options, content);
  return refused === null ? { endpoints } : { uncertified: refused.uncertified };
}

describe("an input nothing touched (spec 018 D33)", () => {
  it("is certified when untouched, stable at the commit's content, held by the commit and equal here", async () => {
    expect(await outcome(hashed())).toEqual({ endpoints: [DATA, LISTING] });
  });

  it("is certified by its stable hash when that differs from the commit and equals here", async () => {
    const other = blob("y\n");
    const p = hashed({ stable: { [DATA]: other } });
    const content = (path: string) => (path === DATA ? other : here(path));
    expect(await outcome(p, EXPORT, content)).toEqual({ endpoints: [DATA, LISTING] });
    // The export checkout holds the commit's content: the ends' hash is not it.
    const refused = (await certify(p)).refused;
    expect(refused?.uncertified).toEqual([DATA]);
    expect(refused?.refusal.detail).toBe(
      "its content at both ends of the part's command is not its content here",
    );
  });

  it("is left out when a hooked process touched it, or a tree above it, or a child withheld (D31)", async () => {
    expect(await outcome(hashed({ touched: [DATA] }))).toEqual({ uncertified: [DATA] });
    expect(await outcome(hashed({ touched: ["data"] }))).toEqual({ uncertified: [DATA] });
    expect(await outcome(hashed({ touched: ["fixtures"] }))).toEqual({ uncertified: [LISTING] });
    expect(await outcome(hashed({ touched: [LISTING] }))).toEqual({ uncertified: [LISTING] });
    expect(await outcome(hashed({ touched: [""] }))).toEqual({ uncertified: [DATA, LISTING] });
    expect(await outcome(hashed({ touched: "all" }))).toEqual({ uncertified: [DATA, LISTING] });
    // A sibling's name is no ancestor.
    expect(await outcome(hashed({ touched: ["dat", "data/x"] }))).toEqual({
      endpoints: [DATA, LISTING],
    });
  });

  it("is left out when its two hashes differ: a change not restored, or a listing changed and kept", async () => {
    expect(await outcome(hashed({ unstable: [DATA] }))).toEqual({ uncertified: [DATA] });
    expect(await outcome(hashed({ unstable: [LISTING] }))).toEqual({ uncertified: [LISTING] });
  });

  it("never certifies an absent input: absent at the ends, at the commit, or here", async () => {
    expect(await outcome(hashed({ stable: { [DATA]: null } }))).toEqual({ uncertified: [DATA] });
    const listingGone = hashed({ stable: { [LISTING]: ABSENT_LISTING } });
    expect(await outcome(listingGone)).toEqual({ uncertified: [LISTING] });
    const content = (path: string) => (path === DATA ? null : here(path));
    expect(await outcome(hashed(), EXPORT, content)).toEqual({ uncertified: [DATA] });
    // Generated before the command and removed after: the commit holds no such file.
    const generated = "src/generated.ts";
    const reuse = new FileReuse(named(hashed()), EXPORT);
    const owner = reuse.owner(REF) as Holder;
    const certified = await reuse.certify(owner, [generated], () => null);
    expect(certified.refused?.uncertified).toEqual([generated]);
  });

  it("never certifies an ignored or untracked input: the commit's tree does not hold it", async () => {
    const built = "out/built.js";
    const content = blob("built\n");
    const p = hashed({ stable: { [built]: content } });
    const reuse = new FileReuse(named(p), EXPORT);
    const owner = reuse.owner(REF) as Holder;
    const certified = await reuse.certify(owner, [built, "out/"], () => content);
    expect(certified.refused?.uncertified).toEqual([built, "out/"]);
  });

  it("never overrides read-time evidence: other content read stays left out (D9)", async () => {
    const p = hashed({ evidence: { ...READ, [DATA]: blob("read during the command\n") } });
    expect(await outcome(p)).toEqual({ uncertified: [DATA] });
  });

  it("does not apply to a part of format 5, a part that took no endpoint hashes, or one of no commit", async () => {
    const left = { uncertified: [DATA, LISTING] };
    expect(await outcome(hashed({ format: "squeal-ci-part/5" }))).toEqual(left);
    const { stable: _s, ...unhashed } = hashed();
    expect(await outcome(unhashed)).toEqual(left);
    const { touched: _t, ...untraced } = hashed();
    expect(await outcome(untraced)).toEqual(left);
    const base = hashed();
    expect(await outcome({ ...base, header: { ...base.header, commit: null } })).toEqual(left);
    expect(await outcome(hashed({ header: { ...base.header, commit: "other" } }))).toEqual(left);
  });

  it("does not apply without the commit's tree: the gate's reading until it passes one", async () => {
    expect(await outcome(hashed(), {})).toEqual({ uncertified: [DATA, LISTING] });
  });

  it("reads the commit's tree once per commit, and content here only for an input a rule holds", async () => {
    const atCommit = vi.fn(async () => TREE);
    const reuse = new FileReuse(named(hashed({ touched: [DATA] })), { atCommit });
    const owner = reuse.owner(REF) as Holder;
    const content = vi.fn(here);
    await reuse.certify(owner, INPUTS, content);
    await reuse.certify(owner, INPUTS, content);
    expect(atCommit).toHaveBeenCalledTimes(1);
    expect(content.mock.calls.map(([path]) => path)).toEqual([
      ...["src/a.ts", "test/a.test.ts", LISTING],
      ...["src/a.ts", "test/a.test.ts", LISTING],
    ]);
  });
});
