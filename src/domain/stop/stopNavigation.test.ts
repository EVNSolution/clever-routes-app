import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute, type AssignedRoute, type AssignedRouteStop } from '../route/assignedRoute';
import {
  buildRouteNavigationUrl,
  buildStopNavigationUrl,
  openRouteNavigation,
  openStopNavigation,
} from './stopNavigation';

const firstStop = sampleAssignedRoute.stops[0]!;

describe('native stop map launch', () => {
  it('opens Google Navigation with server coordinates on every platform', () => {
    const url = buildStopNavigationUrl({ platform: 'ios', stop: firstStop });
    assert.equal(
      url,
      'https://www.google.com/maps/dir/?api=1&destination=43.6487%2C-79.3817&travelmode=driving&dir_action=navigate',
    );
    assert.doesNotMatch(url!, /King|M5X|query=|place_id|key=/u);
    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: firstStop }),
      url,
    );
  });

  it('falls back to the full Canadian address when coordinates are unavailable', () => {
    const addressOnlyStop: AssignedRouteStop = {
      ...firstStop,
      coordinates: null,
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'other', stop: addressOnlyStop }),
      'https://www.google.com/maps/dir/?api=1&destination=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA&travelmode=driving&dir_action=navigate',
    );
  });

  it('uses the full address when the server selects the address navigation target', async () => {
    const addressTargetStop: AssignedRouteStop = {
      ...firstStop,
      navigationTarget: 'ADDRESS',
    };
    const openedUrls: string[] = [];

    const result = await openStopNavigation({
      linking: { openURL: async (url) => openedUrls.push(url) },
      platform: 'android',
      stop: addressTargetStop,
    });

    assert.deepEqual(result, {
      kind: 'opened',
      message: 'Google Maps navigation opened for 100 King St W, Toronto, ON, M5X 1A9, CA.',
      url: 'https://www.google.com/maps/dir/?api=1&destination=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA&travelmode=driving&dir_action=navigate',
    });
    assert.deepEqual(openedUrls, [result.url]);
  });

  it('falls back to valid coordinates when the server selects address but the address is unavailable', () => {
    const addressTargetStop: AssignedRouteStop = {
      ...firstStop,
      address: {
        address1: '',
        address2: null,
        city: '',
        countryCode: '',
        postalCode: '',
        province: '',
      },
      navigationTarget: 'ADDRESS',
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'ios', stop: addressTargetStop }),
      'https://www.google.com/maps/dir/?api=1&destination=43.6487%2C-79.3817&travelmode=driving&dir_action=navigate',
    );
  });

  it('does not navigate to postal and country fields without a street address', async () => {
    const postalOnlyStop: AssignedRouteStop = {
      ...firstStop,
      address: {
        address1: '   ',
        address2: null,
        city: '',
        countryCode: 'CA',
        postalCode: 'M5X 1A9',
        province: '',
      },
      coordinates: null,
      navigationTarget: 'ADDRESS',
    };
    const openedUrls: string[] = [];

    assert.equal(buildStopNavigationUrl({ platform: 'android', stop: postalOnlyStop }), null);
    assert.deepEqual(
      await openStopNavigation({
        linking: { openURL: async (url) => openedUrls.push(url) },
        platform: 'android',
        stop: postalOnlyStop,
      }),
      {
        kind: 'skipped',
        message: 'Stop has no coordinates or address to open in maps.',
        reason: 'missing_destination',
      },
    );
    assert.deepEqual(openedUrls, []);
  });

  it('normalizes a compact lowercase Canadian postal code in the address fallback', () => {
    const addressOnlyStop: AssignedRouteStop = {
      ...firstStop,
      address: { ...firstStop.address, postalCode: 'm5x1a9' },
      coordinates: null,
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: addressOnlyStop }),
      'https://www.google.com/maps/dir/?api=1&destination=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA&travelmode=driving&dir_action=navigate',
    );
  });

  it('rejects invalid coordinates instead of handing Google Maps a broken destination', () => {
    const invalidCoordinateStop: AssignedRouteStop = {
      ...firstStop,
      coordinates: { latitude: 95, longitude: -79.3817 },
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: invalidCoordinateStop }),
      'https://www.google.com/maps/dir/?api=1&destination=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA&travelmode=driving&dir_action=navigate',
    );
  });

  it('treats zero-zero placeholder coordinates as unavailable', () => {
    const placeholderCoordinateStop: AssignedRouteStop = {
      ...firstStop,
      coordinates: { latitude: 0, longitude: 0 },
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: placeholderCoordinateStop }),
      'https://www.google.com/maps/dir/?api=1&destination=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA&travelmode=driving&dir_action=navigate',
    );
  });

  it('skips launch when a stop has no usable coordinates or address', async () => {
    const emptyStop: AssignedRouteStop = {
      ...firstStop,
      address: {
        address1: '',
        address2: null,
        city: '',
        countryCode: '',
        postalCode: '',
        province: '',
      },
      coordinates: null,
    };
    const openedUrls: string[] = [];

    const result = await openStopNavigation({
      linking: { openURL: async (url) => openedUrls.push(url) },
      platform: 'ios',
      stop: emptyStop,
    });

    assert.deepEqual(result, {
      kind: 'skipped',
      message: 'Stop has no coordinates or address to open in maps.',
      reason: 'missing_destination',
    });
    assert.deepEqual(openedUrls, []);
  });

  it('opens the generated platform URL through the provided native linking boundary', async () => {
    const openedUrls: string[] = [];

    const result = await openStopNavigation({
      linking: { openURL: async (url) => openedUrls.push(url) },
      platform: 'ios',
      stop: firstStop,
    });

    assert.deepEqual(result, {
      kind: 'opened',
      message: 'Google Maps navigation opened for 43.6487,-79.3817.',
      url: 'https://www.google.com/maps/dir/?api=1&destination=43.6487%2C-79.3817&travelmode=driving&dir_action=navigate',
    });
    assert.deepEqual(openedUrls, ['https://www.google.com/maps/dir/?api=1&destination=43.6487%2C-79.3817&travelmode=driving&dir_action=navigate']);
  });
});

describe('route map launch', () => {
  it('builds route directions from server coordinates in stop sequence', () => {
    assert.equal(
      buildRouteNavigationUrl({ route: sampleAssignedRoute }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=43.6487%2C-79.3817',
    );
  });

  it('honors each stop navigation target in whole-route directions', () => {
    const routeWithMixedTargets: AssignedRoute = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop, index) => ({
        ...stop,
        navigationTarget: index === 0 ? 'ADDRESS' : 'COORDINATES',
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithMixedTargets }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA',
    );
  });

  it('limits route launch to three waypoints and one destination without hiding the limitation', async () => {
    const routeWithManyStops: AssignedRoute = {
      ...sampleAssignedRoute,
      stops: Array.from({ length: 6 }, (_, index) => ({
        ...firstStop,
        coordinates: { latitude: 43.61 + index * 0.01, longitude: -79.31 - index * 0.01 },
        deliveryStopId: `stop-${index + 1}`,
        sequence: index + 1,
      })),
    };

    const url = buildRouteNavigationUrl({ route: routeWithManyStops });
    assert.match(url!, /destination=43\.64%2C-79\.34/u);
    assert.match(url!, /waypoints=43\.61%2C-79\.31.*43\.62%2C-79\.32.*43\.63%2C-79\.33/u);
    assert.doesNotMatch(url!, /43\.65|43\.66/u);

    const result = await openRouteNavigation({
      linking: { openURL: async () => undefined },
      route: routeWithManyStops,
    });
    assert.equal(
      result.message,
      'Opened the first 4 stops in Google Maps. Mobile links support up to 3 waypoints and 1 destination.',
    );
  });

  it('falls back to full addresses when no coordinates are available', () => {
    const routeWithoutCoordinates: AssignedRoute = {
      ...sampleAssignedRoute,
      routeStopPoints: [],
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        coordinates: null,
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithoutCoordinates }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON%2C%20M5V%201Z2%2C%20CA&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA',
    );
  });

  it('uses full addresses before route coordinates when server coordinates are unavailable', () => {
    const routeWithoutStopCoordinates: AssignedRoute = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        coordinates: null,
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithoutStopCoordinates }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON%2C%20M5V%201Z2%2C%20CA&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA',
    );
  });

  it('uses route input coordinates only when server coordinates and addresses are unavailable', () => {
    const routeWithoutStopDestinations: AssignedRoute = {
      ...sampleAssignedRoute,
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        address: {
          address1: '',
          address2: null,
          city: '',
          countryCode: '',
          postalCode: '',
          province: '',
        },
        coordinates: null,
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithoutStopDestinations }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=43.6487%2C-79.3817',
    );
  });

  it('does not build whole-route directions from postal and country fields alone', () => {
    const routeWithPostalOnlyStops: AssignedRoute = {
      ...sampleAssignedRoute,
      routeStopPoints: [],
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        address: {
          address1: '',
          address2: null,
          city: '',
          countryCode: 'CA',
          postalCode: stop.address.postalCode,
          province: '',
        },
        coordinates: null,
        navigationTarget: 'ADDRESS',
      })),
    };

    assert.equal(buildRouteNavigationUrl({ route: routeWithPostalOnlyStops }), null);
  });

  it('falls back to addresses when every coordinate source is an invalid placeholder', () => {
    const routeWithPlaceholderCoordinates: AssignedRoute = {
      ...sampleAssignedRoute,
      routeStopPoints: sampleAssignedRoute.routeStopPoints.map((point) => ({
        ...point,
        inputCoordinates: [0, 0],
        snappedCoordinates: [0, 0],
      })),
      stops: sampleAssignedRoute.stops.map((stop) => ({
        ...stop,
        coordinates: { latitude: 0, longitude: 0 },
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithPlaceholderCoordinates }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON%2C%20M5V%201Z2%2C%20CA&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA',
    );
  });

  it('opens route directions through the native linking boundary', async () => {
    const openedUrls: string[] = [];

    const result = await openRouteNavigation({
      linking: { openURL: async (url) => openedUrls.push(url) },
      route: sampleAssignedRoute,
    });

    assert.deepEqual(result, {
      kind: 'opened',
      message: 'Opened 2 stops in the map app.',
      url: 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=43.6487%2C-79.3817',
    });
    assert.deepEqual(openedUrls, [
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=43.6487%2C-79.3817',
    ]);
  });

  it('skips launch when a route has no usable destination', async () => {
    const emptyRoute: AssignedRoute = {
      ...sampleAssignedRoute,
      routeStopPoints: [],
      stops: [],
    };
    const openedUrls: string[] = [];

    const result = await openRouteNavigation({
      linking: { openURL: async (url) => openedUrls.push(url) },
      route: emptyRoute,
    });

    assert.deepEqual(result, {
      kind: 'skipped',
      message: 'Route has no destinations to open in maps.',
      reason: 'missing_destination',
    });
    assert.deepEqual(openedUrls, []);
  });
});
