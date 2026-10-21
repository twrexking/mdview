// 跑完 test/ 底下所有 *-test.js：node test/run-all.js
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => /-test\.js$/.test(f)).sort();
let failed = 0;
for (const f of files) {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    process.stdout.write(out);
  } catch (e) {
    failed++;
    process.stdout.write(e.stdout || "");
    process.stderr.write(e.stderr || "");
  }
}
console.log(failed ? `${failed} 支測試檔沒過` : `${files.length} 支測試檔全過`);
process.exit(failed ? 1 : 0);
