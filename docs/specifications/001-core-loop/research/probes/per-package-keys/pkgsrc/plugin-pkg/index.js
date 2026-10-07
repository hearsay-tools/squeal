export default function magic() { return { name: "magic", transform(code) { return code.includes("__MAGIC__") ? code.replaceAll("__MAGIC__", JSON.stringify("magic-v1")) : null; } }; }
