import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteLegFeature, buildRouteMapGeoJson, buildRouteProgressFeature, DEFAULT_DRIVER_MAP_STYLE_URL, groupRouteStopFeaturesByCoordinate, readDriverMapStyleUrl } from './routeMapGeoJson';

describe('route map geojson model', () => {
  it('builds ordered stop points and fitted bounds from an assigned route', () => {
    const model = buildRouteMapGeoJson(sampleAssignedRoute);

    assert.notEqual(model, null);
    assert.deepEqual(model?.depotFeature?.geometry.coordinates, sampleAssignedRoute.routeGeometry?.coordinates[0]);
    assert.equal(model?.depotFeature?.properties.label, 'D');
    assert.deepEqual(model?.stopCollection.features.map((feature) => feature.properties.label), ['1', '2']);
    assert.deepEqual(model?.stopCollection.features.map((feature) => feature.geometry.coordinates), [
      [-79.3817, 43.6487],
      [-79.3909, 43.6509],
    ]);
    assert.deepEqual(model?.snappedStopCollection.features.map((feature) => feature.geometry.coordinates), [
      [-79.3818, 43.6488],
      [-79.391, 43.651],
    ]);
    assert.equal(model?.bounds.length, 4);
    assert.ok(model !== null && model.bounds[0] < model.bounds[2]);
    assert.ok(model !== null && model.bounds[1] < model.bounds[3]);
  });

  it('does not add a separate road stop marker when it is less than one metre from the delivery point', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeStopPoints: sampleAssignedRoute.routeStopPoints.map((point, index) => index === 0
        ? {
            ...point,
            snapDistanceMeters: 0.6,
            snappedCoordinates: [-79.3817001, 43.6487001],
          }
        : point),
    });

    assert.deepEqual(model?.snappedStopCollection.features.map((feature) => feature.properties.sequence), [2]);
  });

  it('groups multiple delivery stops at the same map coordinate without losing their sequences', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => index === 1
        ? { ...stop, coordinates: sampleAssignedRoute.stops[0]?.coordinates ?? null }
        : stop),
      routeStopPoints: sampleAssignedRoute.routeStopPoints.map((point, index) => index === 1
        ? {
            ...point,
            inputCoordinates: sampleAssignedRoute.routeStopPoints[0]?.inputCoordinates ?? null,
            snappedCoordinates: sampleAssignedRoute.routeStopPoints[0]?.snappedCoordinates ?? null,
          }
        : point),
    });

    assert.notEqual(model, null);
    const groups = model === null ? [] : groupRouteStopFeaturesByCoordinate(model.stopCollection.features);

    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0]?.features.map((feature) => feature.properties.sequence), [1, 2]);
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

  it('builds the active route leg from the last completed stop to the current stop', () => {
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
    const legFeature = model === null ? null : buildRouteLegFeature(model, 1, 2);

    assert.equal(legFeature?.properties.kind, 'route_leg');
    assert.deepEqual(legFeature?.geometry.coordinates, [
      [-79.3818, 43.6488],
      [-79.386, 43.6498],
      [-79.391, 43.651],
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

  it('renders confirmed stop coordinates without inventing a route line when geometry is missing', () => {
    const model = buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeGeometry: null,
      routeStopPoints: [],
      stops: sampleAssignedRoute.stops.map((stop, index) => index === 1
        ? { ...stop, coordinates: null }
        : stop),
    });

    assert.notEqual(model, null);
    assert.equal(model?.depotFeature, null);
    assert.equal(model?.routeFeature, null);
    assert.deepEqual(model?.excludedStopSequences, [2]);
    assert.deepEqual(model?.stopCollection.features.map((feature) => feature.properties.sequence), [1]);
  });

  it('does not render an interactive map when no stop location can be confirmed', () => {
    assert.equal(buildRouteMapGeoJson({
      ...sampleAssignedRoute,
      routeGeometry: null,
      routeStopPoints: [],
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        coordinates: { latitude: 0, longitude: 0 },
      })),
    }), null);
  });
});
