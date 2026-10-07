import { setupValue } from "setup-pkg";

(globalThis as { setupValue?: string }).setupValue = setupValue;
