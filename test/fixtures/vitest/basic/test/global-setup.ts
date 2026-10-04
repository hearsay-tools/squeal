import { globalValue } from "../src/global-dep.ts";

export default function setup() {
  return () => globalValue;
}
