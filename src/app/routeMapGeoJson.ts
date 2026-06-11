import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import type { AssignedRoute, AssignedRouteLngLat } from '../domain/route/assignedRoute';

export const DEFAULT_DRIVER_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type RouteDepotFeature = Feature<Point, { kind: 'depot'; label: 'D'; sequence: 0 }>;
export type RouteLineFeature = Feature<LineString, { kind: 'route' }>;
export type RouteStopFeature = Feature<Point, { kind: 'stop'; label: string; sequence: number }>;
export type RouteStopFeatureCollection = FeatureCollection<Point, RouteStopFeature['properties']>;

export type RouteMapGeoJsonModel = {
  bounds: [west: number, south: number, east: number, north: number];
  depotFeature: RouteDepotFeature;
  routeFeature: RouteLineFeature;
  stopCollection: RouteStopFeatureCollection;
};

export function readDriverMapStyleUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') {
    return DEFAULT_DRIVER_MAP_STYLE_URL;
  }

  return trimmed;
}

export function buildRouteMapGeoJson(route: AssignedRoute): RouteMapGeoJsonModel | null {
  const routeCoordinates = route.routeGeometry?.coordinates.filter(isRenderableLngLat) ?? [];
  if (routeCoordinates.length < 2) {
    return null;
  }

  const stopCoordinatesById = new Map<string, AssignedRouteLngLat>();
  for (const point of route.routeStopPoints) {
    const coordinates = point.snappedCoordinates ?? point.inputCoordinates;
    if (isRenderableLngLat(coordinates)) {
      stopCoordinatesById.set(point.deliveryStopId, coordinates);
    }
  }

  const stopFeatures: RouteStopFeature[] = route.stops
    .map((stop): RouteStopFeature | null => {
      const coordinates = stopCoordinatesById.get(stop.deliveryStopId) ?? readStopLngLat(stop.coordinates);
      if (!isRenderableLngLat(coordinates)) {
        return null;
      }

      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates,
        },
        properties: {
          kind: 'stop',
          label: String(stop.sequence),
          sequence: stop.sequence,
        },
      };
    })
    .filter((feature): feature is RouteStopFeature => feature !== null)
    .sort((left, right) => left.properties.sequence - right.properties.sequence);

  const depotCoordinates = routeCoordinates[0];
  const depotFeature: RouteDepotFeature = {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: depotCoordinates,
    },
    properties: {
      kind: 'depot',
      label: 'D',
      sequence: 0,
    },
  };

  const bounds = calculateBounds([
    ...routeCoordinates,
    depotCoordinates,
    ...stopFeatures.map((feature) => feature.geometry.coordinates as AssignedRouteLngLat),
  ]);
  if (bounds === null) {
    return null;
  }

  return {
    bounds,
    depotFeature,
    routeFeature: {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates,
      },
      properties: {
        kind: 'route',
      },
    },
    stopCollection: {
      type: 'FeatureCollection',
      features: stopFeatures,
    },
  };
}

function readStopLngLat(coordinates: AssignedRoute['stops'][number]['coordinates']): AssignedRouteLngLat | null {
  if (coordinates === null) {
    return null;
  }

  return [coordinates.longitude, coordinates.latitude];
}

function calculateBounds(coordinates: AssignedRouteLngLat[]): RouteMapGeoJsonModel['bounds'] | null {
  const renderableCoordinates = coordinates.filter(isRenderableLngLat);
  if (renderableCoordinates.length < 2) {
    return null;
  }

  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [longitude, latitude] of renderableCoordinates) {
    west = Math.min(west, longitude);
    east = Math.max(east, longitude);
    south = Math.min(south, latitude);
    north = Math.max(north, latitude);
  }

  if (!Number.isFinite(west) || !Number.isFinite(east) || !Number.isFinite(south) || !Number.isFinite(north)) {
    return null;
  }

  const minSpan = 0.002;
  if (east - west < minSpan) {
    const center = (east + west) / 2;
    west = center - minSpan / 2;
    east = center + minSpan / 2;
  }
  if (north - south < minSpan) {
    const center = (north + south) / 2;
    south = center - minSpan / 2;
    north = center + minSpan / 2;
  }

  return [west, south, east, north];
}

function isRenderableLngLat(value: unknown): value is AssignedRouteLngLat {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}
