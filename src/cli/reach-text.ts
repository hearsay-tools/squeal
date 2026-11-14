/* Spec 015 D11: how `squeal reach` writes shares and seconds. */

export const pct = (share: number) =>
  share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`;
export const secs = (s: number) => `${s < 10 ? Math.round(s * 10) / 10 : Math.round(s)} s`;
