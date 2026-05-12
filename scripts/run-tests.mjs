#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const testFileSuffix = ".test.ts";
const sourceRoot = "src";

function collectTestFiles(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);

      if (stats.isDirectory()) {
        return collectTestFiles(path);
      }

      return stats.isFile() && path.endsWith(testFileSuffix) ? [path] : [];
    })
    .sort();
}

const testFiles = collectTestFiles(sourceRoot).map((path) =>
  relative(process.cwd(), path),
);

if (testFiles.length === 0) {
  console.error(`No ${testFileSuffix} files found under ${sourceRoot}/.`);
  process.exit(1);
}

const command = process.platform === "win32" ? "tsx.cmd" : "tsx";
const result = spawnSync(command, ["--test", ...testFiles], {
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
