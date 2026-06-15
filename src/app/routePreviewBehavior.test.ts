import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  buildRoutePreviewSequence,
  formatRoutePreviewRegion,
  ROUTE_PREVIEW_ALLOWED_ACTIONS,
  ROUTE_PREVIEW_COPY,
  ROUTE_PREVIEW_PROHIBITED_ACTION_LABELS,
  ROUTE_PREVIEW_REQUIRED_FIELDS,
} from './routePreviewBehavior';
import { sampleAssignedRoute } from '../domain/route/assignedRoute';

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


  it('formats Region as full delivery areas instead of hiding it behind timezone-only fallback', () => {
    assert.equal(formatRoutePreviewRegion(sampleAssignedRoute), 'Toronto, ON');

    const mixedAreaRoute = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        ...stop,
        address: {
          ...stop.address,
          city: index === 0 ? 'Toronto' : 'Mississauga',
          province: 'ON',
        },
      })),
    };

    assert.equal(formatRoutePreviewRegion(mixedAreaRoute), 'Toronto, ON, Mississauga, ON');
  });

  it('formats Sequence as a compact ordered address list, not numeric path markers only', () => {
    const previewSequence = buildRoutePreviewSequence(sampleAssignedRoute, 1);

    assert.deepEqual(previewSequence, {
      items: [
        {
          address: '100 King St W · Toronto, ON',
          deliveryStopId: sampleAssignedRoute.stops[0]!.deliveryStopId,
          marker: '1',
        },
      ],
      overflowCount: 1,
    });
  });

  it('keeps operational session controls out of the Route Details preview component', () => {
    const componentSource = getRoutePreviewComponentSource();

    assert.match(componentSource, /ROUTE_PREVIEW_COPY\.title/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.date/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.map/u);
    assert.match(componentSource, /RoutePreviewRegionBlock/u);
    assert.match(readFileSync(appRootPath, 'utf8'), /function RoutePreviewRegionBlock[\s\S]*ROUTE_PREVIEW_LABELS\.region/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.stops/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.distance/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.time/u);
    assert.match(componentSource, /ROUTE_PREVIEW_LABELS\.sequence/u);
    assert.doesNotMatch(componentSource, /DataRow label=\{ROUTE_PREVIEW_LABELS\.region\}/u);

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
