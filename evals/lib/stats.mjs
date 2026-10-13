// The exact statistics the atomic tier's tables read (spec 006 D10): Fisher's exact test, one-
// and two-sided, and the Wilson score range of a met count.

/** `ln C(n, k)`. */
export function lnChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i++) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * One-sided Fisher exact p that `now` ({ k, n }) is lower than `before`: the chance, with both
 * margins fixed, that `before` holds `before.k` or more of the met sessions.
 */
export function fisherLower(before, now) {
  const met = before.k + now.k;
  const all = before.n + now.n;
  const total = lnChoose(all, before.n);
  let p = 0;
  for (let k = before.k; k <= Math.min(met, before.n); k++)
    p += Math.exp(lnChoose(met, k) + lnChoose(all - met, before.n - k) - total);
  return Math.min(1, p);
}

/** The 95% Wilson score range of `{ k, n }`: `[low, high]`, as fractions. */
export function wilson({ k, n }) {
  const z = 1.959964;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Two-sided Fisher exact p of `a` ({ k, n }) against `b`: with both margins fixed, the chance of a
 * table no more likely than the one observed.
 */
export function fisherTwoSided(a, b) {
  const met = a.k + b.k;
  const all = a.n + b.n;
  const total = lnChoose(all, a.n);
  const pOf = (k) => Math.exp(lnChoose(met, k) + lnChoose(all - met, a.n - k) - total);
  const observed = pOf(a.k);
  let p = 0;
  for (let k = Math.max(0, met - b.n); k <= Math.min(met, a.n); k++) {
    const q = pOf(k);
    if (q <= observed * (1 + 1e-7)) p += q;
  }
  return Math.min(1, p);
}
