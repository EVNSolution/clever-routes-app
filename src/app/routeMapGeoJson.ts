import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

import type { AssignedRoute, AssignedRouteLngLat } from '../domain/route/assignedRoute';

export const DEFAULT_DRIVER_MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type RouteDepotFeature = Feature<Point, { kind: 'depot'; label: 'D'; sequence: 0 }>;
export type RouteLegLineFeature = Feature<LineString, { kind: 'route_leg' }>;
export type RouteLineFeature = Feature<LineString, { kind: 'route' }>;
export type RouteProgressLineFeature = Feature<LineString, { kind: 'route_progress' }>;
export type RouteSnappedStopFeature = Feature<Point, { kind: 'snapped_stop'; sequence: number }>;
export type RouteSnappedStopFeatureCollection = FeatureCollection<Point, RouteSnappedStopFeature['properties']>;
export type RouteStopFeature = Feature<Point, { kind: 'stop'; label: string; sequence: number }>;
export type RouteStopFeatureCollection = FeatureCollection<Point, RouteStopFeature['properties']>;
export type RouteStopFeatureGroup = {
  coordinates: AssignedRouteLngLat;
  features: RouteStopFeature[];
};

export type RouteMapGeoJsonModel = {
  bounds: [west: number, south: number, east: number, north: number];
  depotFeature: RouteDepotFeature | null;
  excludedStopSequences: number[];
  routeFeature: RouteLineFeature | null;
  snappedStopCollection: RouteSnappedStopFeatureCollection;
  stopCollection: RouteStopFeatureCollection;
};

const ROUTE_STOP_POINT_MIN_DISTANCE_METERS = 1;

export function readDriverMapStyleUrl(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') {
    return DEFAULT_DRIVER_MAP_STYLE_URL;
  }

  return trimmed;
}

export function buildRouteMapGeoJson(route: AssignedRoute): RouteMapGeoJsonModel | null {
  const routeCoordinates = normalizeRouteCoordinates(route.routeGeometry?.coordinates ?? []);
  const routeStopPointsById = new Map(route.routeStopPoints.map((point) => [point.deliveryStopId, point]));
  const snappedStopFeatures: RouteSnappedStopFeature[] = [];

  const stopFeatures: RouteStopFeature[] = route.stops
    .map((stop): RouteStopFeature | null => {
      const routeStopPoint = routeStopPointsById.get(stop.deliveryStopId);
      const coordinates = [
        readStopLngLat(stop.coordinates),
        routeStopPoint?.inputCoordinates ?? null,
        routeStopPoint?.snappedCoordinates ?? null,
      ].find(isRenderableLngLat) ?? null;
      if (coordinates === null) {
        return null;
      }

      const snappedCoordinates = routeStopPoint?.snappedCoordinates;
      if (
        isRenderableLngLat(snappedCoordinates)
        && distanceBetweenCoordinatesMeters(coordinates, snappedCoordinates) >= ROUTE_STOP_POINT_MIN_DISTANCE_METERS
      ) {
        snappedStopFeatures.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: snappedCoordinates,
          },
          properties: {
            kind: 'snapped_stop',
            sequence: stop.sequence,
          },
        });
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

  const hasRouteGeometry = routeCoordinates.length >= 2;
  if (!hasRouteGeometry && stopFeatures.length === 0) {
    return null;
  }

  const depotCoordinates = hasRouteGeometry ? routeCoordinates[0] ?? null : null;
  const depotFeature: RouteDepotFeature | null = depotCoordinates === null
    ? null
    : {
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
    ...(hasRouteGeometry ? routeCoordinates : []),
    ...stopFeatures.map((feature) => feature.geometry.coordinates as AssignedRouteLngLat),
    ...snappedStopFeatures.map((feature) => feature.geometry.coordinates as AssignedRouteLngLat),
  ]);
  if (bounds === null) {
    return null;
  }

  return {
    bounds,
    depotFeature,
    excludedStopSequences: route.stops
      .filter((stop) => !stopFeatures.some((feature) => feature.properties.sequence === stop.sequence))
      .map((stop) => stop.sequence),
    routeFeature: hasRouteGeometry && hasRoadFollowingGeometry(routeCoordinates, stopFeatures.length)
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
    snappedStopCollection: {
      type: 'FeatureCollection',
      features: snappedStopFeatures.sort((left, right) => left.properties.sequence - right.properties.sequence),
    },
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

  const targetStop = model.snappedStopCollection.features.find((feature) => feature.properties.sequence === targetStopSequence)
    ?? model.stopCollection.features.find((feature) => feature.properties.sequence === targetStopSequence)
    ?? null;
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

export function buildRouteLegFeature(
  model: RouteMapGeoJsonModel,
  completedStopSequence: number | null,
  currentStopSequence: number | null,
): RouteLegLineFeature | null {
  if (model.routeFeature === null || currentStopSequence === null) {
    return null;
  }

  const routeCoordinates = model.routeFeature.geometry.coordinates as AssignedRouteLngLat[];
  const currentStop = model.snappedStopCollection.features.find((feature) => feature.properties.sequence === currentStopSequence)
    ?? model.stopCollection.features.find((feature) => feature.properties.sequence === currentStopSequence)
    ?? null;
  if (currentStop === null) {
    return null;
  }

  const currentCoordinate = currentStop.geometry.coordinates as AssignedRouteLngLat;
  const currentRouteIndex = findNearestRouteCoordinateIndex(routeCoordinates, currentCoordinate);
  let completedCoordinate = routeCoordinates[0];
  let completedRouteIndex = 0;

  if (completedStopSequence !== null) {
    const completedStop = model.snappedStopCollection.features.find((feature) => feature.properties.sequence === completedStopSequence)
      ?? model.stopCollection.features.find((feature) => feature.properties.sequence === completedStopSequence)
      ?? null;
    if (completedStop === null) {
      return null;
    }

    completedCoordinate = completedStop.geometry.coordinates as AssignedRouteLngLat;
    completedRouteIndex = findNearestRouteCoordinateIndex(routeCoordinates, completedCoordinate);
  }

  if (completedCoordinate === undefined || completedRouteIndex < 0 || currentRouteIndex <= completedRouteIndex) {
    return null;
  }

  const legCoordinates = routeCoordinates.slice(completedRouteIndex, currentRouteIndex + 1);
  if (!sameLngLat(legCoordinates[0], completedCoordinate)) {
    legCoordinates.unshift(completedCoordinate);
  }
  const lastLegCoordinate = legCoordinates[legCoordinates.length - 1];
  if (lastLegCoordinate !== undefined && !sameLngLat(lastLegCoordinate, currentCoordinate)) {
    legCoordinates.push(currentCoordinate);
  }

  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: legCoordinates,
    },
    properties: {
      kind: 'route_leg',
    },
  };
}

export function groupRouteStopFeaturesByCoordinate(features: RouteStopFeature[]): RouteStopFeatureGroup[] {
  const groups: RouteStopFeatureGroup[] = [];

  for (const feature of features) {
    const coordinates = feature.geometry.coordinates as AssignedRouteLngLat;
    const existingGroup = groups.find(
      (group) => distanceBetweenCoordinatesMeters(group.coordinates, coordinates) < ROUTE_STOP_POINT_MIN_DISTANCE_METERS,
    );
    if (existingGroup === undefined) {
      groups.push({ coordinates, features: [feature] });
      continue;
    }

    existingGroup.features.push(feature);
  }

  return groups;
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
  if (renderableCoordinates.length === 0) {
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

function distanceBetweenCoordinatesMeters(left: AssignedRouteLngLat, right: AssignedRouteLngLat): number {
  const earthRadiusMeters = 6_371_000;
  const leftLatitude = degreesToRadians(left[1]);
  const rightLatitude = degreesToRadians(right[1]);
  const latitudeDelta = rightLatitude - leftLatitude;
  const longitudeDelta = degreesToRadians(right[0] - left[0]);
  const sinLatitude = Math.sin(latitudeDelta / 2);
  const sinLongitude = Math.sin(longitudeDelta / 2);
  const haversine = sinLatitude * sinLatitude
    + Math.cos(leftLatitude) * Math.cos(rightLatitude) * sinLongitude * sinLongitude;

  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function degreesToRadians(value: number): number {
  return value * Math.PI / 180;
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
    value[1] <= 90 &&
    !(value[0] === 0 && value[1] === 0)
  );
}
