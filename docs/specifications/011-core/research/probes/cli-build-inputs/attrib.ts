// Throwaway probe for 011-127: children inherit the test file that spawned them.
import { expect } from "vitest";
process.env.R127_TEST = expect.getState().testPath ?? "";
