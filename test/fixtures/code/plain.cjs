// 015-05: plain JavaScript, CommonJS.
"use strict";
function parse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
module.exports.read = function (path, opts) {
  const encoding = opts?.encoding ?? "utf8";
  for (const key in opts) if (!key) throw new Error("empty key");
  return [path, encoding];
};
exports.handler = async (event) => {
  switch (event.type) {
    case "a":
      return 1;
    case "b":
      return event.flag ? 2 : 3;
    default:
      return 0;
  }
};
