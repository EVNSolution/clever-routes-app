import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  ROUTE_PREVIEW_ALLOWED_ACTIONS,
  ROUTE_PREVIEW_COPY,
  ROUTE_PREVIEW_PROHIBITED_ACTION_LABELS,
  ROUTE_PREVIEW_REQUIRED_FIELDS,
} from './routePreviewBehavior';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

function getRoutePreviewComponentSource(): string {
  const source = readFileSync(appRootPath, 'utf8');
  const start = source.indexOf('function RoutePreviewScreen(');
  const end = source.indexOf('function RouteSessionScreen(', start);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);

  return source.slice(start, end);
}

describe('route preview behavior', () => {
  it('defines the approved compact read-only preview fields and actions', () => {
    assert.deepEqual(ROUTE_PREVIEW_REQUIRED_FIELDS, [
      'Date',
      'Map',
      'Region',
      'Stops',
      'Distance',
      'Time',
      'Sequence',
    ]);
    assert.deepEqual(ROUTE_PREVIEW_ALLOWED_ACTIONS, [
      'Back',
      ROUTE_PREVIEW_COPY.mapAccessibilityLabel,
    ]);
  });

  it('keeps operational session controls out of the Route Details preview component', () => {
    const componentSource = getRoutePreviewComponentSource();

    assert.match(componentSource, /ROUTE_PREVIEW_COPY\.title/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.date/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.map/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.region/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.stops/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.distance/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.time/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.sequence/u);

    assert.match(componentSource, /hideRightAction/u);
    assert.doesNotMatch(componentSource, /Menu/u);
    assert.doesNotMatch(componentSource, /PrimaryButton/u);
    assert.doesNotMatch(componentSource, /SecondaryButton/u);
    assert.doesNotMatch(componentSource, /onStartRoute/u);
    assert.doesNotMatch(componentSource, /onOpenNavigation/u);
    assert.doesNotMatch(componentSource, /onOpenStop/u);
    assert.doesNotMatch(componentSource, /onViewCurrentStop/u);

    for (const label of ROUTE_PREVIEW_PROHIBITED_ACTION_LABELS) {
      assert.doesNotMatch(componentSource, new RegExp(label, 'u'));
    }
  });

  it('routes Route Details and Continue Session to distinct app handlers', () => {
    const source = readFileSync(appRootPath, 'utf8');

    assert.match(source, /onOpenRoutePreview=\{handleOpenRoutePreview\}/u);
    assert.match(source, /onContinueRoute=\{handleOpenRouteSession\}/u);
    assert.match(source, /onOpenMapPreview=\{\(\) => openMapPreviewFrom\('routePreview'\)\}/u);
    assert.match(source, /onBack=\{\(\) => setScreen\(mapPreviewBackTarget\)\}/u);
  });
});
