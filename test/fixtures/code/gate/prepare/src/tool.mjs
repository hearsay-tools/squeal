// The built CLI the e2e test starts as a child, as cezar's test starts its packed binaries.
console.log(JSON.stringify({ name: process.argv[2] ?? "tool" }));
