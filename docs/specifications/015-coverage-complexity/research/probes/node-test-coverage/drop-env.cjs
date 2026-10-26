// Throwaway (015-76): in the test file's own process (the node:test runner sets NODE_TEST_CONTEXT
// there, not in the `node --test` parent), removes NODE_V8_COVERAGE from process.env after Node
// read it at startup, so the test sees no variable and child_process has none to copy into a child.
"use strict";
if (process.env.NODE_TEST_CONTEXT && process.env.NODE_V8_COVERAGE) delete process.env.NODE_V8_COVERAGE;
