// Throwaway probe (001-102): a setup file that says which test file this process is running.
import { appendFileSync } from "node:fs";
import { expect } from "vitest";
appendFileSync(process.env.PPK_TRACE, `${process.pid} ${process.ppid} FILE ${expect.getState().testPath}\n`);
