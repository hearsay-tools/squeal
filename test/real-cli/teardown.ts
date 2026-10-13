import { afterAll } from "vitest";
import { disposeAll } from "./machine.js";

/* Every real-CLI file ends with no machine open: its daemons stopped, its hub server killed. */
afterAll(disposeAll);
