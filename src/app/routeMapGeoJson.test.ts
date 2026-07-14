import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteMapGeoJson, buildRouteProgressFeature, DEFAULT_DRIVER_MAP_STYLE_URL, readDriverMapStyleUrl } from './routeMapGeoJson';

describe('route map geojson model', () => {
  it('builds ordered stop points and fitted bounds from an assigned route', () => {
    const model = buildRouteMapGeoJson(sampleAssignedRoute);

    assert.notEqual(model, null);
    assert.deepEqual(model?.depotFeature.geometry.coordinates, sampleAssignedRoute.routeGeometry?.coordinates[0]);
    assert.equal(model?.depotFeature.properties.label, 'D');
    assert.deepEqual(model?.stopCollection.features.map((feature) => feature.properties.label), ['1', '2']);
    assert.equal(model?.bounds.length, 4);
    assert.ok(model !== null && model.bounds[0] < model.bounds[2]);
    assert.ok(model !== null && model.bounds[1] < model.bounds[3]);
  });

  it('does not draw a route line when geometry only connects depot and stops directly', () => {
    const model = buildRouteMapGeoJson(sampleAssignedRoute);

    assert.equal(model?.routeFeature, null);
  });

  it('draws the route line when the server sends road-following geometry vertices', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeGeometry: {
        coordinates: [
          [-79.3832, 43.6532],
          [-79.3828, 43.652],
          [-79.3821, 43.6505],
          [-79.3818, 43.6488],
          [-79.386, 43.6498],
          [-79.391, 43.651],
        ],
        type: 'LineString',
      },
    });

    assert.equal(model?.routeFeature?.geometry.type, 'LineString');
    assert.equal(model?.routeFeature?.geometry.coordinates.length, 6);
  });

  it('builds a progress line from depot to the current stop', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeGeometry: {
        coordinates: [
          [-79.3832, 43.6532],
          [-79.3828, 43.652],
          [-79.3821, 43.6505],
          [-79.3818, 43.6488],
          [-79.386, 43.6498],
          [-79.391, 43.651],
        ],
        type: 'LineString',
      },
    });

    assert.notEqual(model, null);
    const progressFeature = model === null ? null : buildRouteProgressFeature(model, 1);

    assert.equal(progressFeature?.properties.kind, 'route_progress');
    assert.deepEqual(progressFeature?.geometry.coordinates, [
      [-79.3832, 43.6532],
      [-79.3828, 43.652],
      [-79.3821, 43.6505],
      [-79.3818, 43.6488],
    ]);
  });

  it('removes repeated route vertices before sending the line to MapLibre', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeGeometry: {
        coordinates: [
          [-79.3832, 43.6532],
          [-79.3832, 43.6532],
          [-79.3828, 43.652],
          [-79.3828, 43.652],
          [-79.3821, 43.6505],
          [-79.3818, 43.6488],
        ],
        type: 'LineString',
      },
    });

    assert.deepEqual(model?.routeFeature?.geometry.coordinates, [
      [-79.3832, 43.6532],
      [-79.3828, 43.652],
      [-79.3821, 43.6505],
      [-79.3818, 43.6488],
    ]);
  });

  it('falls back to the public OpenFreeMap style when no app-specific style is configured', () => {
    assert.equal(readDriverMapStyleUrl(undefined), DEFAULT_DRIVER_MAP_STYLE_URL);
    assert.equal(readDriverMapStyleUrl('  https://maps.example.com/style.json  '), 'https://maps.example.com/style.json');
  });

  it('does not render an interactive map when route geometry is missing', () => {
    assert.equal(buildRouteMapGeoJson({ ...sampleAssignedRoute, routeGeometry: null }), null);
  });
});
