import type { AbsolutePath } from "../../../core/types/index.js";
import type { ModuleNode } from "./modules.js";

/**
 * Every closure of one graph state as bitsets over its paths in sorted order
 * (spec 003 D3), and the reverse index from path to test files (D4).
 *
 * Built in one pass: strongly connected components (iterative Tarjan), whose
 * closures are unions of their successors' in the order Tarjan emits them.
 * At 1,000 modules a closure is about 35 words and the reverse index about
 * 7 words per path, so a whole rebuild is cheaper than tracking what an edit
 * touched.
 */
export class ClosureIndex {
  /** Paths by rank, sorted by their worktree-relative form. */
  readonly paths: readonly AbsolutePath[];
  /** `paths` in worktree-relative form. */
  private readonly relative: readonly string[];
  private readonly rank: ReadonlyMap<AbsolutePath, number>;
  private readonly words: number;
  private readonly testBits: ReadonlyMap<AbsolutePath, Uint32Array>;
  private readonly testOrder: readonly AbsolutePath[];
  /** Per path rank, a bitset over `testOrder`. */
  private readonly holderBits: Uint32Array;
  private readonly testWords: number;
  readonly preload: Uint32Array;
  /** Ranks of modules with an incompleteness reason, and the reasons. */
  private readonly reasons: readonly (readonly [number, readonly string[]])[];

  constructor(
    nodes: (file: AbsolutePath) => ModuleNode | undefined,
    tests: readonly AbsolutePath[],
    preloadRoots: readonly AbsolutePath[],
    preloadExtra: readonly AbsolutePath[],
    rel: (path: AbsolutePath) => string,
  ) {
    const modules = reachable(nodes, [...tests, ...preloadRoots]);
    const all = new Set<AbsolutePath>(preloadExtra);
    for (const file of modules) {
      all.add(file);
      const node = nodes(file);
      for (const p of node?.reads ?? []) all.add(p);
      for (const p of node?.candidates ?? []) all.add(p);
    }
    const keyed = [...all].map((p) => [rel(p), p] as const);
    keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.paths = keyed.map(([, p]) => p);
    this.relative = keyed.map(([r]) => r);
    this.rank = new Map(this.paths.map((p, i) => [p, i]));
    this.words = Math.ceil(this.paths.length / 32);

    const closureOf = this.closeComponents(nodes, modules);
    this.testOrder = tests;
    this.testBits = new Map(tests.map((t) => [t, closureOf.get(t) ?? this.empty()]));
    this.preload = this.empty();
    for (const root of preloadRoots) or(this.preload, closureOf.get(root) ?? this.empty());
    for (const extra of preloadExtra) this.set(this.preload, extra);

    this.testWords = Math.ceil(tests.length / 32);
    this.holderBits = new Uint32Array(this.paths.length * this.testWords);
    tests.forEach((test, t) => {
      for (const r of this.ranks(this.testBits.get(test) ?? this.empty())) {
        const at = r * this.testWords + (t >>> 5);
        this.holderBits[at] = (this.holderBits[at] ?? 0) | (1 << (t & 31));
      }
    });
    this.reasons = [...modules]
      .map((m) => [this.rank.get(m) ?? -1, nodes(m)?.incomplete ?? []] as const)
      .filter(([, why]) => why.length > 0);
  }

  test(file: AbsolutePath): Uint32Array | undefined {
    return this.testBits.get(file);
  }

  /** Test files whose closure holds `path`, in listing order. */
  holders(path: AbsolutePath): AbsolutePath[] {
    const r = this.rank.get(path);
    if (r === undefined) return [];
    const out: AbsolutePath[] = [];
    for (let w = 0; w < this.testWords; w++) {
      let word = this.holderBits[r * this.testWords + w] ?? 0;
      while (word !== 0) {
        const bit = 31 - Math.clz32(word & -word);
        word &= word - 1;
        const test = this.testOrder[w * 32 + bit];
        if (test !== undefined) out.push(test);
      }
    }
    return out;
  }

  has(bits: Uint32Array, path: AbsolutePath): boolean {
    const r = this.rank.get(path);
    return r !== undefined && ((bits[r >>> 5] ?? 0) & (1 << (r & 31))) !== 0;
  }

  /** The worktree-relative paths of a closure, sorted. */
  members(bits: Uint32Array): string[] {
    const out: string[] = [];
    for (const r of this.ranks(bits)) out.push(this.relative[r] ?? "");
    return out;
  }

  incomplete(bits: Uint32Array): string[] {
    const out = new Set<string>();
    for (const [r, why] of this.reasons) {
      if (((bits[r >>> 5] ?? 0) & (1 << (r & 31))) !== 0) for (const w of why) out.add(w);
    }
    return [...out].sort();
  }

  private *ranks(bits: Uint32Array): Generator<number> {
    for (let w = 0; w < bits.length; w++) {
      let word = bits[w] ?? 0;
      while (word !== 0) {
        yield w * 32 + 31 - Math.clz32(word & -word);
        word &= word - 1;
      }
    }
  }

  private empty(): Uint32Array {
    return new Uint32Array(this.words);
  }

  private set(bits: Uint32Array, path: AbsolutePath): void {
    const r = this.rank.get(path);
    if (r !== undefined) bits[r >>> 5] = (bits[r >>> 5] ?? 0) | (1 << (r & 31));
  }

  /** Iterative Tarjan; a component's closure is its own paths and its successors' closures. */
  private closeComponents(
    nodes: (file: AbsolutePath) => ModuleNode | undefined,
    modules: ReadonlySet<AbsolutePath>,
  ): Map<AbsolutePath, Uint32Array> {
    const closureOf = new Map<AbsolutePath, Uint32Array>();
    const index = new Map<AbsolutePath, number>();
    const low = new Map<AbsolutePath, number>();
    const onStack = new Set<AbsolutePath>();
    const stack: AbsolutePath[] = [];
    let counter = 0;
    for (const start of modules) {
      if (index.has(start)) continue;
      const frames: [AbsolutePath, Iterator<AbsolutePath>][] = [];
      const enter = (file: AbsolutePath) => {
        index.set(file, counter);
        low.set(file, counter++);
        stack.push(file);
        onStack.add(file);
        frames.push([file, (nodes(file)?.deps ?? new Set<AbsolutePath>()).values()]);
      };
      enter(start);
      while (frames.length > 0) {
        const [file, deps] = frames[frames.length - 1] as [AbsolutePath, Iterator<AbsolutePath>];
        const next = deps.next();
        if (!next.done) {
          const dep = next.value;
          if (!index.has(dep)) enter(dep);
          else if (onStack.has(dep))
            low.set(file, Math.min(low.get(file) ?? 0, index.get(dep) ?? 0));
          continue;
        }
        frames.pop();
        const parent = frames[frames.length - 1]?.[0];
        if (parent !== undefined)
          low.set(parent, Math.min(low.get(parent) ?? 0, low.get(file) ?? 0));
        if (low.get(file) !== index.get(file)) continue;
        const component: AbsolutePath[] = [];
        for (let member = stack.pop(); member !== undefined; member = stack.pop()) {
          onStack.delete(member);
          component.push(member);
          if (member === file) break;
        }
        const bits = this.empty();
        for (const member of component) {
          const node = nodes(member);
          this.set(bits, member);
          for (const p of node?.reads ?? []) this.set(bits, p);
          for (const p of node?.candidates ?? []) this.set(bits, p);
          for (const dep of node?.deps ?? []) {
            const done = closureOf.get(dep);
            if (done !== undefined) or(bits, done);
          }
        }
        for (const member of component) closureOf.set(member, bits);
      }
    }
    return closureOf;
  }
}

function reachable(
  nodes: (file: AbsolutePath) => ModuleNode | undefined,
  roots: readonly AbsolutePath[],
): Set<AbsolutePath> {
  const seen = new Set(roots);
  const stack = [...roots];
  for (let file = stack.pop(); file !== undefined; file = stack.pop()) {
    for (const dep of nodes(file)?.deps ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        stack.push(dep);
      }
    }
  }
  return seen;
}

function or(into: Uint32Array, from: Uint32Array): void {
  for (let w = 0; w < into.length; w++) into[w] = (into[w] ?? 0) | (from[w] ?? 0);
}
