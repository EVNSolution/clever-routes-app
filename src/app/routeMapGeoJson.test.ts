import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteMapGeoJson, DEFAULT_DRIVER_MAP_STYLE_URL, readDriverMapStyleUrl } from './routeMapGeoJson';

describe('route map geojson model', () => {
  it('builds a line, ordered stop points, and fitted bounds from an assigned route', () => {
    const model = buildRouteMapGeoJson(sampleAssignedRoute);

    assert.notEqual(model, null);
    assert.deepEqual(model?.depotFeature.geometry.coordinates, sampleAssignedRoute.routeGeometry?.coordinates[0]);
    assert.equal(model?.depotFeature.properties.label, 'D');
    assert.equal(model?.routeFeature.geometry.type, 'LineString');
    assert.deepEqual(model?.stopCollection.features.map((feature) => feature.properties.label), ['1', '2']);
    assert.equal(model?.bounds.length, 4);
    assert.ok(model !== null && model.bounds[0] < model.bounds[2]);
    assert.ok(model !== null && model.bounds[1] < model.bounds[3]);
  });

  it('falls back to the public OpenFreeMap style when no app-specific style is configured', () => {
    assert.equal(readDriverMapStyleUrl(undefined), DEFAULT_DRIVER_MAP_STYLE_URL);
    assert.equal(readDriverMapStyleUrl('  https://maps.example.com/style.json  '), 'https://maps.example.com/style.json');
  });

  it('does not render an interactive map when route geometry is missing', () => {
    assert.equal(buildRouteMapGeoJson({ ...sampleAssignedRoute, routeGeometry: null }), null);
  });
});
