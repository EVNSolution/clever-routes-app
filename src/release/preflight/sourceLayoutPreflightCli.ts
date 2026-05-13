import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { runSourceLayoutPreflight } from './sourceLayoutPreflight';

function collectSourcePaths(directory: string): string[] {
  return readdirSync(directory)
    .flatMap((entry) => {
      const path = join(directory, entry);
      const stats = statSync(path);

      if (stats.isDirectory()) {
        return collectSourcePaths(path);
      }

      return stats.isFile() ? [relative(process.cwd(), path).replaceAll('\\', '/')] : [];
    })
    .sort();
}

const result = runSourceLayoutPreflight({ sourcePaths: collectSourcePaths('src') });

if (!result.ok) {
  console.error('Source layout preflight failed:');
  for (const failure of result.failures) {
    console.error(`- ${failure.path}: ${failure.reason}`);
  }
  process.exit(1);
}

console.log('Source layout preflight passed.');
