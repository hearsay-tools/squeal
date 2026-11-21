import { serveEnd } from "../../src/core/ci/endpoints-child.js";

/*
 * Row 018-67: `squeal ci endpoints-child` without the rest of the CLI, so
 * under tsx it starts in a fraction of the CLI's time and reaches its reads
 * inside a test's short limit. The CLI's own entry runs the same function.
 */
process.exitCode = await serveEnd();
