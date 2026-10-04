import { clamp } from "./util/index.js";

export const add = (a: number, b: number): number => clamp(a + b);
