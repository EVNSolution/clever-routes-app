import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import type { AssignedRoute, AssignedRouteLngLat } from '../domain/route/assignedRoute';

export const DEFAULT_DRIVER_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type RouteDepotFeature = Feature<Point, { kind: 'depot'; label: 'D'; sequence: 0 }>;
export type RouteLineFeature = Feature<LineString, { kind: 'route' }>;
export type RouteProgressLineFeature = Feature<LineString, { kind: 'route_progress' }>;
export type RouteStopFeature = Feature<Point, { kind: 'stop'; label: string; sequence: number }>;
export type RouteStopFeatureCollection = FeatureCollection<Point, RouteStopFeature['properties']>;

export type RouteMapGeoJsonModel = {
  bounds: [west: number, south: number, east: number, north: number];
  depotFeature: RouteDepotFeature;
  routeFeature: RouteLineFeature | null;
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
  const routeCoordinates = normalizeRouteCoordinates(route.routeGeometry?.coordinates ?? []);
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
    routeFeature: hasRoadFollowingGeometry(routeCoordinates, stopFeatures.length)
      ? {
          type: 'Feature',
          geometry: {
            type: 'LineString',
            coordinates: routeCoordinates,
          },
          properties: {
            kind: 'route',
          },
        }
      : null,
    stopCollection: {
      type: 'FeatureCollection',
      features: stopFeatures,
    },
  };
}

export function buildRouteProgressFeature(model: RouteMapGeoJsonModel, targetStopSequence: number | null): RouteProgressLineFeature | null {
  if (model.routeFeature === null || targetStopSequence === null) {
    return null;
  }

  const targetStop = model.stopCollection.features.find((feature) => feature.properties.sequence === targetStopSequence) ?? null;
  if (targetStop === null) {
    return null;
  }

  const routeCoordinates = model.routeFeature.geometry.coordinates as AssignedRouteLngLat[];
  const targetCoordinate = targetStop.geometry.coordinates as AssignedRouteLngLat;
  const targetRouteIndex = findNearestRouteCoordinateIndex(routeCoordinates, targetCoordinate);
  if (targetRouteIndex < 1) {
    return null;
  }

  const progressCoordinates = routeCoordinates.slice(0, targetRouteIndex + 1);
  const lastProgressCoordinate = progressCoordinates[progressCoordinates.length - 1];
  if (lastProgressCoordinate !== undefined && !sameLngLat(lastProgressCoordinate, targetCoordinate)) {
    progressCoordinates.push(targetCoordinate);
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: progressCoordinates,
    },
    properties: {
      kind: 'route_progress',
    },
  };
}

function hasRoadFollowingGeometry(routeCoordinates: AssignedRouteLngLat[], stopCount: number): boolean {
  return routeCoordinates.length > stopCount + 1;
}

function normalizeRouteCoordinates(coordinates: unknown[]): AssignedRouteLngLat[] {
  const normalized: AssignedRouteLngLat[] = [];
  for (const coordinate of coordinates) {
    if (!isRenderableLngLat(coordinate)) {
      continue;
    }

    const previous = normalized[normalized.length - 1];
    if (previous !== undefined && previous[0] === coordinate[0] && previous[1] === coordinate[1]) {
      continue;
    }

    normalized.push(coordinate);
  }

  return normalized;
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

function findNearestRouteCoordinateIndex(routeCoordinates: AssignedRouteLngLat[], targetCoordinate: AssignedRouteLngLat): number {
  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  routeCoordinates.forEach((coordinate, index) => {
    const longitudeDelta = coordinate[0] - targetCoordinate[0];
    const latitudeDelta = coordinate[1] - targetCoordinate[1];
    const distance = longitudeDelta * longitudeDelta + latitudeDelta * latitudeDelta;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function sameLngLat(left: AssignedRouteLngLat, right: AssignedRouteLngLat): boolean {
  return left[0] === right[0] && left[1] === right[1];
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
