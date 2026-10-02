#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const testFilePattern = /\.test\.tsx?$/u;
const sourceRoot = "src";

function collectTestFiles(directory) {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);

      if (stats.isDirectory()) {
        return collectTestFiles(path);
      }

      return stats.isFile() && testFilePattern.test(path) ? [path] : [];
    })
    .sort();
}

function collectRequestedTestFiles(paths) {
  return paths.flatMap((path) => {
    const stats = statSync(path);

    if (stats.isDirectory()) {
      return collectTestFiles(path);
    }

    if (stats.isFile() && testFilePattern.test(path)) {
      return [path];
    }

    return [];
  });
}

const requestedPaths = process.argv.slice(2);
const testFiles = (requestedPaths.length === 0
  ? collectTestFiles(sourceRoot)
  : collectRequestedTestFiles(requestedPaths)
).map((path) =>
  relative(process.cwd(), path),
);

if (testFiles.length === 0) {
  const sourceDescription = requestedPaths.length === 0
    ? `${sourceRoot}/`
    : requestedPaths.join(", ");
  console.error(`No .test.ts or .test.tsx files found for ${sourceDescription}.`);
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
