import { greeting } from "../src/setup-dep.ts";

(globalThis as { greeting?: string }).greeting = greeting;
