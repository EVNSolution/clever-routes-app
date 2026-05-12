import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { sampleAssignedRoute, type AssignedRouteStop } from './assignedRoute';
import {
  buildStopNavigationUrl,
  openStopNavigation,
} from './stopNavigation';

const firstStop = sampleAssignedRoute.stops[0]!;

describe('native stop map launch', () => {
  it('builds iOS and Android map URLs from stop coordinates without committing to a provider SDK', () => {
    assert.equal(
      buildStopNavigationUrl({ platform: 'ios', stop: firstStop }),
      'http://maps.apple.com/?ll=43.6487,-79.3817&q=Stop%201%20%231001',
    );
    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: firstStop }),
      'geo:43.6487,-79.3817?q=43.6487%2C-79.3817(Stop%201%20%231001)',
    );
  });

  it('falls back to a formatted address when coordinates are unavailable', () => {
    const stopWithoutCoordinates: AssignedRouteStop = {
      ...firstStop,
      coordinates: null,
    };

    assert.equal(
      buildStopNavigationUrl({ platform: 'android', stop: stopWithoutCoordinates }),
      'geo:0,0?q=100%20King%20St%20W%2C%20Toronto%2C%20ON%2C%20M5X%201A9%2C%20CA(Stop%201%20%231001)',
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
      message: 'Map opened for Stop 1 #1001.',
      url: 'http://maps.apple.com/?ll=43.6487,-79.3817&q=Stop%201%20%231001',
    });
    assert.deepEqual(openedUrls, ['http://maps.apple.com/?ll=43.6487,-79.3817&q=Stop%201%20%231001']);
  });
});
