export type SourceLayoutFailure = {
  path: string;
  reason: string;
};

export type SourceLayoutPreflightInput = {
  sourcePaths: string[];
};

export type SourceLayoutPreflightResult = {
  failures: SourceLayoutFailure[];
  ok: boolean;
};

const allowedSourceRoots = [
  'src/app/',
  'src/api/',
  'src/domain/',
  'src/features/',
  'src/platform/',
  'src/release/',
  'src/shared/',
  'src/test/',
  'src/ui/',
];

const sourceLayoutFailureReason = 'Source files must live under an approved role folder from docs/code-organization.md.';

export function runSourceLayoutPreflight(input: SourceLayoutPreflightInput): SourceLayoutPreflightResult {
  const failures = input.sourcePaths
    .filter((path) => isSourceFile(path) && !isAllowedSourcePath(path))
    .map((path) => ({
      path,
      reason: sourceLayoutFailureReason,
    }));

  return {
    failures,
    ok: failures.length === 0,
  };
}

function isSourceFile(path: string): boolean {
  return path.startsWith('src/') && /\.(ts|tsx)$/u.test(path) && !path.endsWith('.test.ts') && !path.endsWith('.test.tsx');
}

function isAllowedSourcePath(path: string): boolean {
  return allowedSourceRoots.some((root) => path.startsWith(root));
}
