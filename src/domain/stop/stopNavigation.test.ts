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
  it('searches with street, city, and province without postal or country fields', () => {
    assert.equal(
      buildStopNavigationUrl({ platform: 'ios', stop: firstStop }),
      'http://maps.apple.com/?q=100%20King%20St%20W%2C%20Toronto%2C%20ON',
    );
    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: firstStop }),
      'geo:0,0?q=100%20King%20St%20W%2C%20Toronto%2C%20ON',
    );
    assert.doesNotMatch(buildStopNavigationUrl({ platform: 'android', stop: firstStop })!, /Stop%20|M5X|CA/u);
  });

  it('falls back to coordinates only when the address is unavailable', () => {
    const stopWithoutAddress: AssignedRouteStop = {
      ...firstStop,
      address: {
        address1: '',
        address2: null,
        city: '',
        countryCode: '',
        postalCode: '',
        province: '',
      },
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: stopWithoutAddress }),
      'geo:43.6487,-79.3817?q=43.6487%2C-79.3817',
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
      message: 'Map search opened for 100 King St W, Toronto, ON.',
      url: 'http://maps.apple.com/?q=100%20King%20St%20W%2C%20Toronto%2C%20ON',
    });
    assert.deepEqual(openedUrls, ['http://maps.apple.com/?q=100%20King%20St%20W%2C%20Toronto%2C%20ON']);
  });
});

describe('route map launch', () => {
  it('builds map-app directions from stop addresses in route sequence before using coordinates', () => {
    assert.equal(
      buildRouteNavigationUrl({ route: sampleAssignedRoute }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON',
    );
  });

  it('falls back to stop coordinates when addresses are unavailable', () => {
    const routeWithoutAddresses: AssignedRoute = {
      ...sampleAssignedRoute,
      routeStopPoints: [],
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
      })),
    };

    assert.equal(
      buildRouteNavigationUrl({ route: routeWithoutAddresses }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.6509%2C-79.3909&waypoints=43.6487%2C-79.3817',
    );
  });

  it('uses OSRM stop point coordinates only when both addresses and stop coordinates are unavailable', () => {
    const routeWithoutAddressesOrStopCoordinates: AssignedRoute = {
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
      buildRouteNavigationUrl({ route: routeWithoutAddressesOrStopCoordinates }),
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=43.651%2C-79.391&waypoints=43.6488%2C-79.3818',
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
      url: 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON',
    });
    assert.deepEqual(openedUrls, [
      'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=200%20Queen%20St%20W%2C%20Unit%204%2C%20Toronto%2C%20ON&waypoints=100%20King%20St%20W%2C%20Toronto%2C%20ON',
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
