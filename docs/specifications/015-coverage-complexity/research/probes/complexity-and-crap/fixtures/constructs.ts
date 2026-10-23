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
