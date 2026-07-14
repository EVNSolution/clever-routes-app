import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteMapGeoJson, buildRouteProgressFeature } from './routeMapGeoJson';

const CAMERA_PADDING = { bottom: 58, left: 42, right: 42, top: 96 } as const;

type NativeRouteMapPreviewProps = {
  currentStepIndex: number;
  mapStyleUrl: string;
  onUnavailable(): void;
  route: AssignedRoute;
};

export function NativeRouteMapPreview({ currentStepIndex, mapStyleUrl, onUnavailable, route }: NativeRouteMapPreviewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const mapLoadKey = `${mapStyleUrl}:${route.id}`;
  const [mapLoadedState, setMapLoadedState] = useState<{ key: string; loaded: true } | null>(null);
  const mapLoaded = mapLoadedState?.key === mapLoadKey;
  const model = useMemo(() => buildRouteMapGeoJson(route), [route]);
  const currentStopSequence = currentStepIndex <= 0 ? null : route.stops[currentStepIndex - 1]?.sequence ?? null;
  const progressFeature = useMemo(() => model === null ? null : buildRouteProgressFeature(model, currentStopSequence), [currentStopSequence, model]);

  useEffect(() => {
    if (model !== null) {
      return;
    }

    onUnavailable();
  }, [model, onUnavailable]);

  useEffect(() => {
    if (model === null || !mapLoaded) {
      return;
    }

    cameraRef.current?.fitBounds(model.bounds, { duration: 0, padding: CAMERA_PADDING });
  }, [mapLoaded, model]);

  if (model === null) {
    return null;
  }

  return (
    <View style={styles.container}>
      <Map
        attribution={false}
        attributionPosition={{ bottom: 10, right: 10 }}
        compass={false}
        compassPosition={{ right: 10, top: 10 }}
        doubleTapHoldZoom
        doubleTapZoom
        dragPan
        logo={false}
        mapStyle={mapStyleUrl}
        onDidFailLoadingMap={onUnavailable}
        onDidFinishLoadingStyle={() => setMapLoadedState({ key: mapLoadKey, loaded: true })}
        preferredFramesPerSecond={30}
        scaleBar={false}
        style={styles.map}
        touchPitch={false}
        touchRotate={false}
        touchZoom
      >
        <Camera
          maxZoom={16}
          minZoom={4}
          padding={CAMERA_PADDING}
          ref={cameraRef}
          initialViewState={{ bounds: model.bounds, padding: CAMERA_PADDING }}
        />
        {model.routeFeature !== null ? (
          <GeoJSONSource data={model.routeFeature} id="route-preview-line-source">
            <Layer
              id="route-preview-line-shadow"
              source="route-preview-line-source"
              type="line"
              paint={{
                'line-color': '#ffffff',
                'line-opacity': 0.82,
                'line-width': 6,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
            <Layer
              id="route-preview-line"
              source="route-preview-line-source"
              type="line"
              paint={{
                'line-color': '#0b57d0',
                'line-opacity': 0.94,
                'line-width': 4,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
        {progressFeature !== null ? (
          <GeoJSONSource data={progressFeature} id="route-preview-progress-source">
            <Layer
              id="route-preview-progress-line"
              source="route-preview-progress-source"
              type="line"
              paint={{
                'line-color': '#f97316',
                'line-opacity': 0.96,
                'line-width': 4,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
          </GeoJSONSource>
        ) : null}
        <Marker
          anchor="center"
          id="route-preview-depot"
          lngLat={model.depotFeature.geometry.coordinates as [number, number]}
        >
          <View style={[styles.markerHalo, styles.depotMarkerHalo, currentStepIndex > 0 && styles.completedMarkerHalo, currentStepIndex <= 0 && styles.currentMarkerHalo]}>
            <View style={[styles.markerDot, styles.depotMarkerDot, currentStepIndex > 0 && styles.completedMarkerDot, currentStepIndex <= 0 && styles.currentMarkerDot]}>
              <Text style={styles.markerText}>{model.depotFeature.properties.label}</Text>
            </View>
          </View>
        </Marker>
        {model.stopCollection.features.map((feature) => {
          const isCurrentStop = feature.properties.sequence === currentStopSequence;
          const isCompletedStop = currentStopSequence !== null && feature.properties.sequence < currentStopSequence;

          return (
            <Marker
              anchor="center"
              id={`route-preview-stop-${feature.properties.sequence}`}
              key={feature.properties.sequence}
              lngLat={feature.geometry.coordinates as [number, number]}
            >
              <View style={[styles.markerHalo, isCompletedStop && styles.completedMarkerHalo, isCurrentStop && styles.currentMarkerHalo]}>
                <View style={[styles.markerDot, isCompletedStop && styles.completedMarkerDot, isCurrentStop && styles.currentMarkerDot]}>
                  <Text style={styles.markerText}>{feature.properties.label}</Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#eaf2f7',
    flex: 1,
    minHeight: 430,
    overflow: 'hidden',
  },
  completedMarkerDot: {
    backgroundColor: '#475467',
  },
  completedMarkerHalo: {
    backgroundColor: '#e5e7eb',
  },
  currentMarkerDot: {
    backgroundColor: '#f97316',
  },
  currentMarkerHalo: {
    backgroundColor: '#fed7aa',
    borderRadius: 9,
    height: 17,
    width: 17,
  },
  depotMarkerDot: {
    backgroundColor: '#12b76a',
  },
  depotMarkerHalo: {
    backgroundColor: '#ecfdf3',
  },
  map: {
    flex: 1,
  },
  markerDot: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 6,
    height: 12,
    justifyContent: 'center',
    width: 12,
  },
  markerHalo: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 7,
    height: 14,
    justifyContent: 'center',
    width: 14,
  },
  markerText: {
    color: '#ffffff',
    fontSize: 7,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 8,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
});
