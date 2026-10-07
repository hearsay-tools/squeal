let p; try { p = require("phantom").p; } catch { p = () => "no-phantom"; } exports.cjs = () => "cjs+" + p();
