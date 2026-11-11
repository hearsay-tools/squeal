export function mul(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < b; i++) r += a;
  return r;
}
export function neverCalled(): string {
  return "no";
}
