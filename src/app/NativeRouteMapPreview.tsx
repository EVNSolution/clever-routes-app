import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteMapGeoJson } from './routeMapGeoJson';

const CAMERA_PADDING = { bottom: 58, left: 42, right: 42, top: 58 } as const;

type NativeRouteMapPreviewProps = {
  allowDragPan?: boolean;
  currentStepIndex: number;
  mapStyleUrl: string;
  onUnavailable(): void;
  route: AssignedRoute;
};

export function NativeRouteMapPreview({ allowDragPan = true, currentStepIndex, mapStyleUrl, onUnavailable, route }: NativeRouteMapPreviewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const mapLoadKey = `${mapStyleUrl}:${route.id}`;
  const [mapLoadedState, setMapLoadedState] = useState<{ key: string; loaded: true } | null>(null);
  const mapLoaded = mapLoadedState?.key === mapLoadKey;
  const model = useMemo(() => buildRouteMapGeoJson(route), [route]);
  const currentStopSequence = currentStepIndex <= 0 ? null : route.stops[currentStepIndex - 1]?.sequence ?? null;
  const currentDestinationLabel = currentStepIndex <= 0 ? 'Depot pickup' : currentStopSequence === null ? null : `Current: Stop ${currentStopSequence}`;

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
        androidView="texture"
        attribution
        attributionPosition={{ bottom: 10, right: 10 }}
        compass
        compassPosition={{ right: 10, top: 10 }}
        doubleTapHoldZoom
        doubleTapZoom
        dragPan={allowDragPan}
        logo={false}
        mapStyle={mapStyleUrl}
        onDidFailLoadingMap={onUnavailable}
        onDidFinishLoadingStyle={() => setMapLoadedState({ key: mapLoadKey, loaded: true })}
        preferredFramesPerSecond={30}
        scaleBar
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
        <GeoJSONSource data={model.routeFeature} id="route-preview-line-source">
          <Layer
            id="route-preview-line-shadow"
            source="route-preview-line-source"
            type="line"
            paint={{
              'line-color': '#ffffff',
              'line-opacity': 0.94,
              'line-width': 8,
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
              'line-opacity': 0.96,
              'line-width': 5,
            }}
            layout={{
              'line-cap': 'round',
              'line-join': 'round',
            }}
          />
        </GeoJSONSource>
        <Marker
          anchor="center"
          id="route-preview-depot"
          lngLat={model.depotFeature.geometry.coordinates as [number, number]}
        >
          <View style={[styles.markerHalo, styles.depotMarkerHalo, currentStepIndex <= 0 && styles.currentMarkerHalo]}>
            <View style={[styles.markerDot, styles.depotMarkerDot, currentStepIndex <= 0 && styles.currentMarkerDot]}>
              <Text style={styles.markerText}>{model.depotFeature.properties.label}</Text>
            </View>
          </View>
        </Marker>
        {model.stopCollection.features.map((feature) => {
          const isCurrentStop = feature.properties.sequence === currentStopSequence;

          return (
            <Marker
              anchor="center"
              id={`route-preview-stop-${feature.properties.sequence}`}
              key={feature.properties.sequence}
              lngLat={feature.geometry.coordinates as [number, number]}
            >
              <View style={[styles.markerHalo, isCurrentStop && styles.currentMarkerHalo]}>
                <View style={[styles.markerDot, isCurrentStop && styles.currentMarkerDot]}>
                  <Text style={styles.markerText}>{feature.properties.label}</Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </Map>
      <View pointerEvents="none" style={styles.badge}>
        <Text style={styles.badgeText}>Interactive map</Text>
      </View>
      {currentDestinationLabel !== null ? (
        <View pointerEvents="none" style={styles.currentDestinationBadge}>
          <Text style={styles.currentDestinationBadgeText}>{currentDestinationLabel}</Text>
        </View>
      ) : null}
      <View pointerEvents="none" style={styles.hint}>
        <Text style={styles.hintText}>{allowDragPan ? 'Pinch to zoom · Drag to pan' : 'Tap for full map'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    backgroundColor: 'rgba(12, 18, 32, 0.76)',
    borderRadius: 999,
    left: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    position: 'absolute',
    top: 16,
  },
  badgeText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  container: {
    backgroundColor: '#eaf2f7',
    flex: 1,
    minHeight: 430,
    overflow: 'hidden',
  },
  depotMarkerDot: {
    backgroundColor: '#12b76a',
  },
  depotMarkerHalo: {
    backgroundColor: '#ecfdf3',
  },
  currentDestinationBadge: {
    backgroundColor: 'rgba(249, 115, 22, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
    right: 14,
    top: 16,
  },
  currentDestinationBadgeText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  currentMarkerDot: {
    backgroundColor: '#f97316',
  },
  currentMarkerHalo: {
    backgroundColor: '#fed7aa',
    borderRadius: 17,
    height: 34,
    width: 34,
  },
  hint: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 999,
    bottom: 14,
    left: 16,
    paddingHorizontal: 10,
    paddingVertical: 6,
    position: 'absolute',
  },
  hintText: {
    color: '#344054',
    fontSize: 11,
    fontWeight: '800',
  },
  map: {
    flex: 1,
  },
  markerDot: {
    alignItems: 'center',
    backgroundColor: '#0b57d0',
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  markerHalo: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 14,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  markerText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
    includeFontPadding: false,
    lineHeight: 16,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
});
