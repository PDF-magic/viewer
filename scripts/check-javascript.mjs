import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && /\.(?:m?js)$/.test(entry.name)) files.push(path);
  }
}
for (const directory of ["src", "scripts", "tests"]) await collect(directory);
if (!files.length) throw new Error("No JavaScript sources found");
let failed = 0;
for (const file of files.sort()) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) {
    failed++;
    console.error("Syntax check failed: " + file + "\n" + (checked.stderr || checked.stdout));
  }
}
console.log("Checked JavaScript syntax in " + files.length + " files; failures: " + failed);
if (failed) process.exitCode = 1;
