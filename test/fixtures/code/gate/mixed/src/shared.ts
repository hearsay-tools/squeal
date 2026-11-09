export function fromVitest(x: number): number {
  if (x > 1) return x;
  return -x;
}

export function fromNode(x: number): number {
  if (x > 1) return x * 2;
  return 0;
}
