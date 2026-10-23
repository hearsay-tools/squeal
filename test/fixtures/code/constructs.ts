// One construct per function; the expected classic McCabe count is base 1 plus the construct.
export function base(a: number) { return a; }
export function ifOnly(a: boolean) { if (a) { return 1; } return 0; }
export function ifElse(a: boolean) { if (a) { return 1; } else { return 0; } }
export function elseIf(a: number) { if (a > 1) { return 1; } else if (a > 0) { return 2; } return 0; }
export function forLoop(n: number) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }
export function forOf(xs: number[]) { let s = 0; for (const x of xs) { s += x; } return s; }
export function forIn(o: object) { let s = 0; for (const k in o) { s += k.length; } return s; }
export function whileLoop(n: number) { while (n > 0) { n--; } return n; }
export function doWhile(n: number) { do { n--; } while (n > 0); return n; }
export function switchTwoCases(a: number) { switch (a) { case 1: return "a"; case 2: return "b"; default: return "c"; } }
export function tryCatch() { try { return JSON.parse("x"); } catch { return null; } }
export function tryFinally() { try { return 1; } finally { console.log("x"); } }
export function ternary(a: boolean) { return a ? 1 : 0; }
export function andOp(a: boolean, b: boolean) { return a && b; }
export function orOp(a: boolean, b: boolean) { return a || b; }
export function threeAnds(a: boolean, b: boolean, c: boolean) { return a && b && c; }
export function nullish(a: number | undefined) { return a ?? 0; }
export function optMember(a?: { b: number }) { return a?.b; }
export function optCall(a?: () => number) { return a?.(); }
export function defaultParam(a = 1) { return a; }
export function destructDefault({ a = 1 }: { a?: number }) { return a; }
export function logicalAssign(a: { b?: number }) { a.b ??= 1; return a; }
export function optionalParamType(a?: number, b?: string): number { return a ?? b?.length ?? 0; }
export type IsString<T> = T extends string ? true : false;
export function conditionalTypeInSignature<T>(x: T): T extends string ? 1 : 2 { return x as never; }
export function outerWithInner(xs: number[]) {
  return xs.map((x) => { if (x > 0) { return x; } return 0; });
}
export const arrowConst = (a: boolean) => (a ? 1 : 0);
export class K {
  method(a: boolean) { if (a) { return 1; } return 0; }
  get prop() { return this.method(true) || 2; }
  field = (a: boolean) => a && true;
}
// 015-05: the edges ESLint counts its own way, after the research's one construct per function.
export function optSubscript(a?: number[], k = 0) { return a?.[k]; }
export function chainOnce(a?: { b: { c: number } }) { return a?.b.c; }
export function chainTwice(a?: { b?: { c: number } }) { return a?.b?.c; }
export function optCallMember(a?: { f(): number }) { return a?.f(); }
export function orAssign(a: { b?: number }) { a.b ||= 1; a.b &&= 2; return a; }
export function arrayDefault([a = 1, b = 2]: number[]) { return a + b; }
export function renamedDefault({ a: x = 1 }: { a?: number }) { return x; }
export function assignDefault(o: number[]) { let a; [a = 1] = o; return a; }
export function labelled(xs: number[][]) { outer: for (const x of xs) { for (const y of x) { if (y) continue outer; } } }
export async function forAwait(xs: AsyncIterable<number>) { for await (const x of xs) { if (x) return x; } return 0; }
export function* generator(n: number) { while (n-- > 0) { yield n || 0; } }
export function switchFallThrough(a: number) { switch (a) { case 1: case 2: return "a"; default: case 3: return "b"; } }
export function nestedTernary(a: number) { return a > 1 ? "x" : a > 0 ? "y" : "z"; }
export function typeOnly(a: unknown): a is string { return typeof a === "string" satisfies boolean; }
export const curried = (a: boolean) => (b: boolean) => a && b;
export class Fields {
  static count = 0 || 1;
  plain = Fields.count > 0 ? 1 : 2;
  static { if (Fields.count) { Fields.count = Fields.count ?? 0; } }
  constructor(private readonly x = 1, public y?: number) { if (y) { this.y = y; } }
  get value() { return this.x ?? 0; }
  set value(v: number) { this.y = v || undefined; }
  #hidden(a: boolean) { return a && this.x; }
  static async load(a?: string) { return a?.length; }
  [Symbol.iterator]() { return [this.x].values(); }
}
export abstract class Shape {
  abstract area(): number;
  describe() { return this.area() > 0 ? "solid" : "flat"; }
}
export function overload(a: string): string;
export function overload(a: number): number;
export function overload(a: string | number) { return typeof a === "string" ? a : a + 1; }
export default function (a: boolean) { return a || false; }
export const objectMethods = {
  plain() { return 1; },
  withIf(a: boolean) { if (a) { return 1; } return 0; },
  arrow: (a?: number) => a ?? 0,
  "quoted-key": function (a: boolean) { return a && 1; },
};
export function withCallback(xs: number[]) { return xs.filter((x) => x > 0 && x < 9).map(function (x) { return x ?? 0; }); }
export function innerDefault(f = (a?: number) => a ?? 0) { return f(); }
export function ternaryDefault(a: boolean, b = a ? 1 : 2) { return b; }
export const Klass = class { m(a: boolean) { return a ? 1 : 0; } };
export function classInside(a: boolean) { class Inner { x = a ? 1 : 2; m() { return a && 1; } } return new Inner(); }
export namespace Space { export function inside(a: boolean) { return a || 1; } }
export function deep(a: number, b: number) {
  if (a > 0) { if (b > 0) { return 1; } else if (b < 0) { return 2; } }
  while (a > b) { a--; if (a === 3) break; }
  try { return a > 1 ? a : b; } catch (e) { return e instanceof Error && e.message ? 1 : 0; } finally { a = 0; }
}
