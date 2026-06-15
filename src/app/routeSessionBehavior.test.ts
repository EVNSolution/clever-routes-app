import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');
const nativeMapPath = join(dirname(fileURLToPath(import.meta.url)), 'NativeRouteMapPreview.tsx');

function getRouteSessionComponentSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function RouteSessionScreen(');
  const end = source.indexOf('function LiveTrackingScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('route session current task behavior', () => {
  it('puts task-specific primary actions inside Current Task instead of leaving only generic route buttons', () => {
    const componentSource = getRouteSessionComponentSource();

    assert.match(componentSource, /label: 'Complete Pickup'/u);
    assert.match(componentSource, /label: 'Add Proof & Tip'/u);
    assert.match(componentSource, /showPrimaryActionInCurrentTask/u);
    assert.match(componentSource, /styles\.currentTaskActions/u);
    assert.match(componentSource, /label="View Stop Details"/u);
  });

  it('passes current step context into map previews for current destination highlighting', () => {
    const appSource = readFileSync(appRootPath, 'utf8');
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(appSource, /currentStepIndex=\{currentStepIndex\}/u);
    assert.match(nativeMapSource, /currentStopSequence/u);
    assert.match(nativeMapSource, /currentMarkerHalo/u);
    assert.match(nativeMapSource, /Current: Stop/u);
  });

  it('reduces the regular native stop marker halo so the white border is less dominant', () => {
    const nativeMapSource = readFileSync(nativeMapPath, 'utf8');

    assert.match(nativeMapSource, /markerHalo:[\s\S]*height: 28,[\s\S]*width: 28,/u);
    assert.match(nativeMapSource, /markerDot:[\s\S]*height: 24,[\s\S]*width: 24,/u);
  });
});
