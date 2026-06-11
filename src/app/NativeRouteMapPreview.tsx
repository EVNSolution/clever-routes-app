import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AssignedRoute } from '../domain/route/assignedRoute';
import { buildRouteMapGeoJson } from './routeMapGeoJson';

const CAMERA_PADDING = { bottom: 58, left: 42, right: 42, top: 58 } as const;

type NativeRouteMapPreviewProps = {
  allowDragPan?: boolean;
  mapStyleUrl: string;
  onUnavailable(): void;
  route: AssignedRoute;
};

export function NativeRouteMapPreview({ allowDragPan = true, mapStyleUrl, onUnavailable, route }: NativeRouteMapPreviewProps) {
  const cameraRef = useRef<CameraRef>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const model = useMemo(() => buildRouteMapGeoJson(route), [route]);

  useEffect(() => {
    setMapLoaded(false);
  }, [mapStyleUrl, route.id]);

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
        onDidFinishLoadingStyle={() => setMapLoaded(true)}
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
        {model.stopCollection.features.map((feature) => (
          <Marker
            anchor="center"
            id={`route-preview-stop-${feature.properties.sequence}`}
            key={feature.properties.sequence}
            lngLat={feature.geometry.coordinates as [number, number]}
          >
            <View style={styles.markerHalo}>
              <View style={styles.markerDot}>
                <Text style={styles.markerText}>{feature.properties.label}</Text>
              </View>
            </View>
          </Marker>
        ))}
      </Map>
      <View pointerEvents="none" style={styles.badge}>
        <Text style={styles.badgeText}>Interactive map</Text>
      </View>
      <View pointerEvents="none" style={styles.hint}>
        <Text style={styles.hintText}>{allowDragPan ? 'Pinch to zoom · Drag to pan' : 'Pinch to zoom · Swipe for details'}</Text>
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
    borderRadius: 16,
    height: 32,
    justifyContent: 'center',
    width: 32,
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
