process.on("SIGTERM", (...args) => { console.log(JSON.stringify({ args, ppid: process.ppid })); process.exit(0); });
console.log("ready " + process.pid); setInterval(() => {}, 1000);
