import Ionicons from '@expo/vector-icons/Ionicons';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type CameraRef,
  type CircleLayerSpecification,
  type SymbolLayerSpecification,
} from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { AssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteLegFeature, buildRouteMapGeoJson, buildRouteProgressFeature, groupRouteStopFeaturesByCoordinate, type RouteMapGeoJsonModel } from './routeMapGeoJson';
import { ROUTE_VISUAL_STATE_COLORS } from './routeVisualState';

const CAMERA_PADDING = { bottom: 58, left: 42, right: 42, top: 96 } as const;
const CURRENT_TRIP_CAMERA_PADDING = { bottom: 72, left: 52, right: 96, top: 72 } as const;
const CURRENT_LOCATION_ZOOM = 16;
const DESTINATION_FOCUS_ZOOM = 13;
const LIVE_LOCATION_MAX_AGE_MS = 15_000;
const LIVE_LOCATION_CACHED_REQUIRED_ACCURACY_METERS = 100;
const LIVE_LOCATION_DISTANCE_INTERVAL_METERS = 0;
const LIVE_LOCATION_UPDATE_INTERVAL_MS = 1_000;
const MIN_CURRENT_TRIP_SPAN_DEGREES = 0.0015;
const ROUTE_MARKER_SOURCE_ID = 'route-preview-marker-source';
const ROUTE_MARKER_CAPSULE_IMAGE_ID = 'route-preview-marker-capsule';
const SNAPPED_STOP_SOURCE_ID = 'route-preview-snapped-stop-source';
const USER_LOCATION_SOURCE_ID = 'route-preview-user-location-source';

type RouteCoordinate = [longitude: number, latitude: number];

type RouteMarkerProperties = {
  kind: 'depot' | 'stop';
  groupSize: number;
  label: string;
  markerState: 'completed' | 'current' | 'upcoming';
  sequence: number;
};

const ROUTE_MARKER_CIRCLE_PAINT = {
  'circle-color': [
    'case',
    ['==', ['get', 'markerState'], 'current'], ROUTE_VISUAL_STATE_COLORS.current,
    ['==', ['get', 'markerState'], 'completed'], ROUTE_VISUAL_STATE_COLORS.completed,
    ['==', ['get', 'kind'], 'depot'], ROUTE_VISUAL_STATE_COLORS.current,
    ROUTE_VISUAL_STATE_COLORS.upcoming,
  ],
  'circle-opacity': 1,
  'circle-radius': [
    'case',
    ['==', ['get', 'markerState'], 'current'], 10.5,
    ['==', ['get', 'kind'], 'depot'], 8.5,
    6,
  ],
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': [
    'case',
    ['==', ['get', 'markerState'], 'current'], 2,
    ['==', ['get', 'kind'], 'depot'], 1.5,
    0.75,
  ],
} satisfies CircleLayerSpecification['paint'];

const ROUTE_MARKER_LABEL_LAYOUT = {
  'text-allow-overlap': true,
  'text-anchor': 'center',
  'text-field': ['get', 'label'],
  'text-font': ['Noto Sans Bold'],
  'text-ignore-placement': true,
  'text-size': [
    'case',
    ['==', ['get', 'markerState'], 'current'], 10,
    ['==', ['get', 'kind'], 'depot'], 8,
    8,
  ],
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_LABEL_PAINT = {
  'text-color': '#ffffff',
  'text-opacity': 1,
} satisfies SymbolLayerSpecification['paint'];

const ROUTE_MARKER_GROUP_LAYOUT = {
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
  'icon-image': ROUTE_MARKER_CAPSULE_IMAGE_ID,
  'icon-text-fit': 'both',
  'icon-text-fit-padding': [6, 9, 6, 9],
  'symbol-sort-key': [
    'case',
    ['==', ['get', 'markerState'], 'current'], 3,
    ['==', ['get', 'markerState'], 'completed'], 1,
    2,
  ],
  'text-allow-overlap': true,
  'text-anchor': 'center',
  'text-field': ['get', 'label'],
  'text-font': ['Noto Sans Bold'],
  'text-ignore-placement': true,
  'text-size': 10,
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_GROUP_BORDER_LAYOUT = {
  ...ROUTE_MARKER_GROUP_LAYOUT,
  'icon-text-fit-padding': [8, 11, 8, 11],
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_GROUP_COMPACT_LAYOUT = {
  ...ROUTE_MARKER_GROUP_LAYOUT,
  'icon-text-fit-padding': [2, 6, 2, 6],
  'text-size': 8,
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_GROUP_COMPACT_BORDER_LAYOUT = {
  ...ROUTE_MARKER_GROUP_COMPACT_LAYOUT,
  'icon-text-fit-padding': [3, 7, 3, 7],
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_GROUP_BORDER_PAINT = {
  'icon-color': '#ffffff',
  'icon-opacity': 1,
  'text-opacity': 0,
} satisfies SymbolLayerSpecification['paint'];

const ROUTE_MARKER_GROUP_PAINT = {
  'icon-color': [
    'case',
    ['==', ['get', 'markerState'], 'current'], ROUTE_VISUAL_STATE_COLORS.current,
    ['==', ['get', 'markerState'], 'completed'], ROUTE_VISUAL_STATE_COLORS.completed,
    ROUTE_VISUAL_STATE_COLORS.upcoming,
  ],
  'icon-opacity': 1,
  'text-color': '#ffffff',
  'text-opacity': 1,
} satisfies SymbolLayerSpecification['paint'];

const ROUTE_MARKER_SESSION_FOCUS_LAYOUT = {
  'icon-allow-overlap': true,
  'icon-ignore-placement': false,
  'icon-image': ROUTE_MARKER_CAPSULE_IMAGE_ID,
  'icon-text-fit': 'both',
  'icon-text-fit-padding': [5, 7, 5, 7],
  'text-allow-overlap': true,
  'text-anchor': 'center',
  'text-field': ['get', 'label'],
  'text-font': ['Noto Sans Bold'],
  'text-ignore-placement': false,
  'text-size': 10,
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_SESSION_CONTEXT_LAYOUT = {
  'icon-allow-overlap': false,
  'icon-ignore-placement': false,
  'icon-image': ROUTE_MARKER_CAPSULE_IMAGE_ID,
  'icon-text-fit': 'both',
  'icon-text-fit-padding': [2, 5, 2, 5],
  'text-allow-overlap': false,
  'text-anchor': 'center',
  'text-field': ['get', 'label'],
  'text-font': ['Noto Sans Bold'],
  'text-ignore-placement': false,
  'text-size': 8,
} satisfies SymbolLayerSpecification['layout'];

const ROUTE_MARKER_SESSION_PAINT = {
  ...ROUTE_MARKER_GROUP_PAINT,
  'icon-halo-color': '#ffffff',
  'icon-halo-width': [
    'case',
    ['==', ['get', 'markerState'], 'current'], 1.5,
    ['==', ['get', 'kind'], 'depot'], 1.25,
    0.75,
  ],
} satisfies SymbolLayerSpecification['paint'];

const SNAPPED_STOP_CIRCLE_PAINT = {
  'circle-color': '#344054',
  'circle-opacity': 0.92,
  'circle-radius': 3.5,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': 1.25,
} satisfies CircleLayerSpecification['paint'];

const USER_LOCATION_CIRCLE_PAINT = {
  'circle-blur': 0.1,
  'circle-color': '#e32636',
  'circle-radius': 9.9,
  'circle-stroke-color': '#ffffff',
  'circle-stroke-width': 2,
} satisfies CircleLayerSpecification['paint'];

type NativeRouteMapPreviewProps = {
  compactRouteFocus?: boolean;
  currentStepIndex: number;
  mapStyleUrl: string;
  onUnavailable(): void;
  route: AssignedRoute;
  showUserLocation?: boolean;
};

export function NativeRouteMapPreview({
  compactRouteFocus = false,
  currentStepIndex,
  mapStyleUrl,
  onUnavailable,
  route,
  showUserLocation = false,
}: NativeRouteMapPreviewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const mapLoadKey = `${mapStyleUrl}:${route.id}`;
  const [mapLoadedState, setMapLoadedState] = useState<{ key: string; loaded: true } | null>(null);
  const [currentPosition, setCurrentPosition] = useState<Location.LocationObject | null>(null);
  const mapLoaded = mapLoadedState?.key === mapLoadKey;
  const model = useMemo(() => buildRouteMapGeoJson(route), [route]);
  const userCoordinate = useMemo((): RouteCoordinate | null => {
    if (
      !showUserLocation
      || currentPosition === null
    ) {
      return null;
    }

    const latitude = currentPosition?.coords.latitude;
    const longitude = currentPosition?.coords.longitude;
    if (
      typeof latitude !== 'number'
      || typeof longitude !== 'number'
      || !Number.isFinite(latitude)
      || !Number.isFinite(longitude)
      || latitude < -90
      || latitude > 90
      || longitude < -180
      || longitude > 180
    ) {
      return null;
    }

    return [longitude, latitude];
  }, [currentPosition, showUserLocation]);
  const currentStopSequence = currentStepIndex <= 0 ? null : route.stops[currentStepIndex - 1]?.sequence ?? null;
  const currentDestinationCoordinate = useMemo(
    () => model === null ? null : getCurrentDestinationCoordinate(model, currentStopSequence),
    [currentStopSequence, model],
  );
  const currentDestinationFocusCoordinate = useMemo(
    () => model === null ? null : getCurrentDestinationFocusCoordinate(model, currentStopSequence),
    [currentStopSequence, model],
  );
  const lastCompletedStopSequence = currentStepIndex <= 1 ? null : route.stops[currentStepIndex - 2]?.sequence ?? null;
  const completedRouteFeature = useMemo(
    () => model === null ? null : buildRouteProgressFeature(model, lastCompletedStopSequence),
    [lastCompletedStopSequence, model],
  );
  const activeLegFeature = useMemo(
    () => model === null ? null : buildRouteLegFeature(model, lastCompletedStopSequence, currentStopSequence),
    [currentStopSequence, lastCompletedStopSequence, model],
  );
  const routeMarkerCollection = useMemo(
    () => model === null ? null : buildRouteMarkerCollection(model, currentStepIndex, currentStopSequence),
    [currentStepIndex, currentStopSequence, model],
  );
  const userLocationFeature = useMemo<Feature<Point, { kind: 'user_location' }> | null>(() => (
    userCoordinate === null
      ? null
      : {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: userCoordinate },
          properties: { kind: 'user_location' },
        }
  ), [userCoordinate]);

  useEffect(() => {
    if (!showUserLocation) {
      return;
    }

    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    function acceptNewestPosition(position: Location.LocationObject) {
      if (!active || Date.now() - position.timestamp > LIVE_LOCATION_MAX_AGE_MS) {
        return;
      }

      setCurrentPosition((current) => (
        current === null || position.timestamp >= current.timestamp ? position : current
      ));
    }

    async function subscribeToLiveLocation() {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (!active || !permission.granted) {
          return;
        }

        const cachedPosition = await Location.getLastKnownPositionAsync({
          maxAge: LIVE_LOCATION_MAX_AGE_MS,
          requiredAccuracy: LIVE_LOCATION_CACHED_REQUIRED_ACCURACY_METERS,
        });
        if (cachedPosition !== null) {
          acceptNewestPosition(cachedPosition);
        }
        if (!active) {
          return;
        }

        const nextSubscription = await Location.watchPositionAsync({
          accuracy: Location.Accuracy.Highest,
          distanceInterval: LIVE_LOCATION_DISTANCE_INTERVAL_METERS,
          timeInterval: LIVE_LOCATION_UPDATE_INTERVAL_MS,
        }, acceptNewestPosition);
        if (!active) {
          nextSubscription.remove();
          return;
        }

        subscription = nextSubscription;
      } catch {
        // The map remains usable without live GPS when the device provider is unavailable.
      }
    }

    void subscribeToLiveLocation();

    return () => {
      active = false;
      subscription?.remove();
    };
  }, [showUserLocation]);

  useEffect(() => {
    if (model !== null || showUserLocation) {
      return;
    }

    onUnavailable();
  }, [model, onUnavailable, showUserLocation]);

  useEffect(() => {
    if (!mapLoaded) {
      return;
    }

    if (currentDestinationFocusCoordinate !== null) {
      cameraRef.current?.easeTo({ center: currentDestinationFocusCoordinate, duration: 0, zoom: DESTINATION_FOCUS_ZOOM });
      return;
    }

    if (model !== null) {
      cameraRef.current?.fitBounds(model.bounds, { duration: 0, padding: CAMERA_PADDING });
    }
  }, [currentDestinationFocusCoordinate, mapLoaded, model]);

  if (model === null && !showUserLocation) {
    return null;
  }

  function handleMapUnavailable() {
    onUnavailable();
  }

  function focusNextDestination(duration: number) {
    if (!mapLoaded || currentDestinationFocusCoordinate === null) {
      return;
    }

    cameraRef.current?.easeTo({ center: currentDestinationFocusCoordinate, duration, zoom: DESTINATION_FOCUS_ZOOM });
  }

  function handleCenterNextDestination() {
    focusNextDestination(300);
  }

  function handleFitCurrentTrip() {
    if (!mapLoaded) {
      return;
    }

    if (userCoordinate !== null && currentDestinationCoordinate !== null) {
      cameraRef.current?.fitBounds(buildCurrentTripBounds(userCoordinate, currentDestinationCoordinate), {
        duration: 300,
        padding: CURRENT_TRIP_CAMERA_PADDING,
      });
      return;
    }

    if (userCoordinate !== null) {
      cameraRef.current?.easeTo({ center: userCoordinate, duration: 300, zoom: CURRENT_LOCATION_ZOOM });
      return;
    }

    if (currentDestinationCoordinate !== null) {
      cameraRef.current?.easeTo({ center: currentDestinationCoordinate, duration: 300, zoom: DESTINATION_FOCUS_ZOOM });
    }
  }

  function handleCenterUserLocation() {
    if (!mapLoaded || userCoordinate === null) {
      return;
    }

    cameraRef.current?.easeTo({ center: userCoordinate, duration: 300, zoom: CURRENT_LOCATION_ZOOM });
  }

  return (
    <View style={styles.container}>
      <Map
        androidView="texture"
        attribution={false}
        attributionPosition={{ bottom: 10, right: 10 }}
        compass={false}
        compassPosition={{ right: 10, top: 10 }}
        doubleTapHoldZoom
        doubleTapZoom
        dragPan
        logo={false}
        mapStyle={mapStyleUrl}
        onDidFailLoadingMap={handleMapUnavailable}
        onDidFinishLoadingStyle={() => setMapLoadedState({ key: mapLoadKey, loaded: true })}
        scaleBar={false}
        style={styles.map}
        touchPitch={false}
        touchRotate={false}
        touchZoom
      >
        <Images
          images={{
            [ROUTE_MARKER_CAPSULE_IMAGE_ID]: {
              source: require('../../assets/map-marker-capsule.png'),
              sdf: true,
            },
          }}
        />
        <Camera
          maxZoom={17}
          minZoom={4}
          padding={CAMERA_PADDING}
          ref={cameraRef}
          initialViewState={currentDestinationCoordinate !== null
            ? { center: currentDestinationFocusCoordinate ?? currentDestinationCoordinate, padding: CURRENT_TRIP_CAMERA_PADDING, zoom: DESTINATION_FOCUS_ZOOM }
            : model === null ? undefined : { bounds: model.bounds, padding: CAMERA_PADDING }}
        />
        {model !== null && model.routeFeature !== null ? (
          <GeoJSONSource data={model.routeFeature} id="route-preview-line-source" key="route-preview-line-source">
            <Layer
              id="route-preview-line"
              source="route-preview-line-source"
              type="line"
              paint={{
                'line-color': ROUTE_VISUAL_STATE_COLORS.upcoming,
                'line-opacity': 1,
                'line-width': 2.75,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
        {completedRouteFeature !== null ? (
          <GeoJSONSource data={completedRouteFeature} id="route-preview-completed-source" key="route-preview-completed-source">
            <Layer
              id="route-preview-completed-line"
              source="route-preview-completed-source"
              type="line"
              paint={{
                'line-color': ROUTE_VISUAL_STATE_COLORS.completed,
                'line-opacity': 1,
                'line-width': 2.75,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
        {activeLegFeature !== null ? (
          <GeoJSONSource data={activeLegFeature} id="route-preview-active-leg-source" key="route-preview-active-leg-source">
            <Layer
              id="route-preview-active-leg-line"
              source="route-preview-active-leg-source"
              type="line"
              paint={{
                'line-color': ROUTE_VISUAL_STATE_COLORS.current,
                'line-opacity': 1,
                'line-width': 3.25,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
        {model !== null && model.snappedStopCollection.features.length > 0 ? (
          <GeoJSONSource data={model.snappedStopCollection} id={SNAPPED_STOP_SOURCE_ID} key={SNAPPED_STOP_SOURCE_ID}>
            <Layer
              id="route-preview-snapped-stop"
              minzoom={15}
              paint={SNAPPED_STOP_CIRCLE_PAINT}
              source={SNAPPED_STOP_SOURCE_ID}
              type="circle"
            />
          </GeoJSONSource>
        ) : null}
        {routeMarkerCollection !== null ? (
          <GeoJSONSource data={routeMarkerCollection} id={ROUTE_MARKER_SOURCE_ID} key={ROUTE_MARKER_SOURCE_ID}>
            {compactRouteFocus ? [
                <Layer
                  filter={[
                    'any',
                    ['==', ['get', 'markerState'], 'current'],
                    ['==', ['get', 'kind'], 'depot'],
                  ]}
                  id="route-preview-marker-session-focus"
                  key="route-preview-marker-session-focus"
                  layout={ROUTE_MARKER_SESSION_FOCUS_LAYOUT}
                  paint={ROUTE_MARKER_SESSION_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
                <Layer
                  filter={[
                    'all',
                    ['!=', ['get', 'markerState'], 'current'],
                    ['!=', ['get', 'kind'], 'depot'],
                  ]}
                  id="route-preview-marker-session-context"
                  key="route-preview-marker-session-context"
                  layout={ROUTE_MARKER_SESSION_CONTEXT_LAYOUT}
                  paint={ROUTE_MARKER_SESSION_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
              ] : [
                <Layer
                  filter={['==', ['get', 'groupSize'], 1]}
                  id="route-preview-marker-circle"
                  key="route-preview-marker-circle"
                  layout={{
                    'circle-sort-key': [
                      'case',
                      ['==', ['get', 'markerState'], 'current'], 3,
                      ['==', ['get', 'kind'], 'depot'], 2,
                      1,
                    ],
                  }}
                  paint={ROUTE_MARKER_CIRCLE_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="circle"
                />,
                <Layer
                  filter={['==', ['get', 'groupSize'], 1]}
                  id="route-preview-marker-label"
                  key="route-preview-marker-label"
                  layout={ROUTE_MARKER_LABEL_LAYOUT}
                  paint={ROUTE_MARKER_LABEL_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
                <Layer
                  filter={['all', ['>', ['get', 'groupSize'], 1], ['!=', ['get', 'markerState'], 'current']]}
                  id="route-preview-marker-group-compact-border"
                  key="route-preview-marker-group-compact-border"
                  layout={ROUTE_MARKER_GROUP_COMPACT_BORDER_LAYOUT}
                  paint={ROUTE_MARKER_GROUP_BORDER_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
                <Layer
                  filter={['all', ['>', ['get', 'groupSize'], 1], ['!=', ['get', 'markerState'], 'current']]}
                  id="route-preview-marker-group-compact"
                  key="route-preview-marker-group-compact"
                  layout={ROUTE_MARKER_GROUP_COMPACT_LAYOUT}
                  paint={ROUTE_MARKER_GROUP_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
                <Layer
                  filter={['all', ['>', ['get', 'groupSize'], 1], ['==', ['get', 'markerState'], 'current']]}
                  id="route-preview-marker-group-border"
                  key="route-preview-marker-group-border"
                  layout={ROUTE_MARKER_GROUP_BORDER_LAYOUT}
                  paint={ROUTE_MARKER_GROUP_BORDER_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
                <Layer
                  filter={['all', ['>', ['get', 'groupSize'], 1], ['==', ['get', 'markerState'], 'current']]}
                  id="route-preview-marker-group"
                  key="route-preview-marker-group"
                  layout={ROUTE_MARKER_GROUP_LAYOUT}
                  paint={ROUTE_MARKER_GROUP_PAINT}
                  source={ROUTE_MARKER_SOURCE_ID}
                  type="symbol"
                />,
              ]}
          </GeoJSONSource>
        ) : null}
        {showUserLocation && userLocationFeature !== null ? (
          <GeoJSONSource data={userLocationFeature} id={USER_LOCATION_SOURCE_ID}>
            <Layer
              id="route-preview-user-location"
              paint={USER_LOCATION_CIRCLE_PAINT}
              source={USER_LOCATION_SOURCE_ID}
              type="circle"
            />
          </GeoJSONSource>
        ) : null}
      </Map>
      <View pointerEvents="box-none" style={styles.mapControls}>
        <Pressable
          accessibilityLabel="Center on next destination"
          accessibilityRole="button"
          accessibilityState={{ disabled: !mapLoaded || currentDestinationFocusCoordinate === null }}
          disabled={!mapLoaded || currentDestinationFocusCoordinate === null}
          hitSlop={8}
          onPress={handleCenterNextDestination}
          style={({ pressed }) => [styles.mapControlButton, (!mapLoaded || currentDestinationFocusCoordinate === null) && styles.mapControlButtonDisabled, pressed && styles.mapControlButtonPressed]}
        >
          <Ionicons color={ROUTE_VISUAL_STATE_COLORS.current} name="flag-outline" size={23} />
        </Pressable>
        <Pressable
          accessibilityLabel="Fit current location and next destination"
          accessibilityRole="button"
          accessibilityState={{ disabled: !mapLoaded || (userCoordinate === null && currentDestinationCoordinate === null) }}
          disabled={!mapLoaded || (userCoordinate === null && currentDestinationCoordinate === null)}
          hitSlop={8}
          onPress={handleFitCurrentTrip}
          style={({ pressed }) => [styles.mapControlButton, (!mapLoaded || (userCoordinate === null && currentDestinationCoordinate === null)) && styles.mapControlButtonDisabled, pressed && styles.mapControlButtonPressed]}
        >
          <Ionicons color="#111827" name="scan-outline" size={23} />
        </Pressable>
        {showUserLocation ? (
          <Pressable
            accessibilityLabel="Center on current location"
            accessibilityRole="button"
            accessibilityState={{ disabled: !mapLoaded || userCoordinate === null }}
            disabled={!mapLoaded || userCoordinate === null}
            hitSlop={8}
            onPress={handleCenterUserLocation}
            style={({ pressed }) => [styles.mapControlButton, (!mapLoaded || userCoordinate === null) && styles.mapControlButtonDisabled, pressed && styles.mapControlButtonPressed]}
          >
            <Ionicons color="#0b57d0" name="locate" size={24} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function buildRouteMarkerCollection(
  model: RouteMapGeoJsonModel,
  currentStepIndex: number,
  currentStopSequence: number | null,
): FeatureCollection<Point, RouteMarkerProperties> {
  return {
    type: 'FeatureCollection',
    features: [
      {
        ...model.depotFeature,
        properties: {
          ...model.depotFeature.properties,
          groupSize: 1,
          markerState: currentStepIndex > 0 ? 'completed' : 'current',
        },
      },
      ...groupRouteStopFeaturesByCoordinate(model.stopCollection.features).map((group): Feature<Point, RouteMarkerProperties> => {
        const sequences = group.features.map((feature) => feature.properties.sequence);
        const firstFeature = group.features[0];
        if (firstFeature === undefined) {
          throw new Error('Route marker group cannot be empty.');
        }

        return {
          ...firstFeature,
          geometry: {
            type: 'Point',
            coordinates: group.coordinates,
          },
          properties: {
            ...firstFeature.properties,
            groupSize: group.features.length,
            label: group.features.map((feature) => feature.properties.label).join('  '),
            markerState: currentStopSequence !== null && sequences.includes(currentStopSequence)
              ? 'current'
              : currentStopSequence !== null && sequences.every((sequence) => sequence < currentStopSequence)
                ? 'completed'
                : 'upcoming',
          },
        };
      }),
    ],
  };
}

function getCurrentDestinationCoordinate(
  model: RouteMapGeoJsonModel,
  currentStopSequence: number | null,
): RouteCoordinate {
  if (currentStopSequence === null) {
    return model.depotFeature.geometry.coordinates as RouteCoordinate;
  }

  return (model.stopCollection.features.find((feature) => feature.properties.sequence === currentStopSequence)?.geometry.coordinates
    ?? model.depotFeature.geometry.coordinates) as RouteCoordinate;
}

function getCurrentDestinationFocusCoordinate(
  model: RouteMapGeoJsonModel,
  currentStopSequence: number | null,
): RouteCoordinate {
  const deliveryCoordinate = getCurrentDestinationCoordinate(model, currentStopSequence);
  if (currentStopSequence === null) {
    return deliveryCoordinate;
  }

  const snappedCoordinate = model.snappedStopCollection.features.find(
    (feature) => feature.properties.sequence === currentStopSequence,
  )?.geometry.coordinates as RouteCoordinate | undefined;
  if (snappedCoordinate === undefined) {
    return deliveryCoordinate;
  }

  return [
    (deliveryCoordinate[0] + snappedCoordinate[0]) / 2,
    (deliveryCoordinate[1] + snappedCoordinate[1]) / 2,
  ];
}

function buildCurrentTripBounds(
  userCoordinate: RouteCoordinate,
  destinationCoordinate: RouteCoordinate,
): [west: number, south: number, east: number, north: number] {
  const centerLongitude = (userCoordinate[0] + destinationCoordinate[0]) / 2;
  const centerLatitude = (userCoordinate[1] + destinationCoordinate[1]) / 2;
  const longitudeSpan = Math.max(Math.abs(userCoordinate[0] - destinationCoordinate[0]), MIN_CURRENT_TRIP_SPAN_DEGREES);
  const latitudeSpan = Math.max(Math.abs(userCoordinate[1] - destinationCoordinate[1]), MIN_CURRENT_TRIP_SPAN_DEGREES);

  return [
    centerLongitude - longitudeSpan / 2,
    centerLatitude - latitudeSpan / 2,
    centerLongitude + longitudeSpan / 2,
    centerLatitude + latitudeSpan / 2,
  ];
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#eaf2f7',
    flex: 1,
    minHeight: 430,
    overflow: 'hidden',
  },
  map: {
    flex: 1,
  },
  mapControlButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#d0d5dd',
    borderRadius: 22,
    borderWidth: 1,
    elevation: 4,
    height: 44,
    justifyContent: 'center',
    shadowColor: '#101828',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 5,
    width: 44,
  },
  mapControlButtonDisabled: {
    opacity: 0.42,
  },
  mapControlButtonPressed: {
    opacity: 0.72,
  },
  mapControls: {
    bottom: 34,
    gap: 10,
    position: 'absolute',
    right: 16,
    width: 44,
  },
});
