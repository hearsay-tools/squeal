import { hub } from "./hub";

export const leaf = (x: number): number => (x > 0 ? hub(x) + 1 : 0);
