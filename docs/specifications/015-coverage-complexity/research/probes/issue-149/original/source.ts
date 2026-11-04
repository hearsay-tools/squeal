type X = { id: string }
export const single = (over: Partial<X> = {}): X => ({ id: 'r1', ...over }) as X
export const multi = (over: Partial<X> = {}): X =>
  ({ id: 'r1', ...over }) as unknown as X
export const unused = (over: Partial<X> = {}): X => ({ id: 'r1', ...over }) as X
type R = { id: string }
const m = { g(r: R): boolean { return r.id.length > 0 } }
export const f = (r: R) => (m as unknown as { g(r: R): boolean }).g(r);
