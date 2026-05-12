import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CONSENT_COPY_VERSIONS,
  createDriverConsentApiClient,
  createMockDriverConsentService,
  submitDriverConsent,
} from './driverConsent';

describe('driver consent gate UX flow', () => {
  it('records required consent before route details can be revealed', async () => {
    const recordedAt = new Date('2026-05-12T06:20:00.000Z');
    const calls: unknown[] = [];
    const result = await submitDriverConsent(
      {
        appContext: { appVersion: '0.1.0' },
        deviceContext: { platform: 'ios' },
        now: () => recordedAt,
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
      {
        recordDriverConsents: async (input) => {
          calls.push(input);
          return {
            status: 'CONSENT_RECORDED',
            recordedAt: recordedAt.toISOString(),
            records: input.consents,
          };
        },
      },
    );

    assert.equal(result.kind, 'consent_recorded');
    assert.equal(result.flowState, 'consent_recorded');
    assert.deepEqual(calls, [
      {
        appContext: { appVersion: '0.1.0' },
        consents: [
          { accepted: true, type: 'LOCATION_INFORMATION', version: CONSENT_COPY_VERSIONS.locationInformation },
          { accepted: true, type: 'PERSONAL_INFORMATION', version: CONSENT_COPY_VERSIONS.personalInformation },
        ],
        deviceContext: { platform: 'ios' },
        recordedAt,
        routeContext: '11111111-1111-4111-8111-111111111111',
      },
    ]);
    assert.equal(JSON.stringify(result).includes('deliveryStop'), false);
    assert.equal(JSON.stringify(result).includes('address1'), false);
  });

  it('keeps the consent gate blocked when consent submission fails', async () => {
    const result = await submitDriverConsent(
      {
        appContext: null,
        deviceContext: null,
        now: () => new Date('2026-05-12T06:20:00.000Z'),
        routeContext: 'route-context',
      },
      {
        recordDriverConsents: async () => {
          throw new Error('network down');
        },
      },
    );

    assert.deepEqual(result, {
      flowState: 'consent_required',
      kind: 'consent_error',
      message: 'Consent could not be recorded. Check the connection and try again.',
    });
  });

  it('posts consent records to the delivery-server consent endpoint', async () => {
    const requests: { body: unknown; headers: Record<string, string>; method: string; url: string }[] = [];
    const client = createDriverConsentApiClient({
      accessToken: 'driver.jwt',
      baseUrl: 'https://delivery.example.com/',
      fetchImpl: async (url, init) => {
        requests.push({
          body: JSON.parse(String(init?.body)),
          headers: init?.headers ?? {},
          method: String(init?.method),
          url: String(url),
        });
        return {
          ok: true,
          json: async () => ({
            data: {
              status: 'CONSENT_RECORDED',
              recordedAt: '2026-05-12T06:20:00.000Z',
              records: [
                { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
                { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
              ],
            },
            error: null,
          }),
        };
      },
    });

    const recordedAt = new Date('2026-05-12T06:20:00.000Z');
    const result = await client.recordDriverConsents({
      appContext: { appVersion: '0.1.0' },
      consents: [
        { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
        { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
      ],
      deviceContext: { platform: 'android' },
      recordedAt,
      routeContext: '11111111-1111-4111-8111-111111111111',
    });

    assert.equal(result.status, 'CONSENT_RECORDED');
    assert.deepEqual(requests, [
      {
        body: {
          appContext: { appVersion: '0.1.0' },
          consents: [
            { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
            { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
          ],
          deviceContext: { platform: 'android' },
          recordedAt: '2026-05-12T06:20:00.000Z',
          routeContext: '11111111-1111-4111-8111-111111111111',
        },
        headers: {
          Authorization: 'Bearer driver.jwt',
          'Content-Type': 'application/json',
        },
        method: 'POST',
        url: 'https://delivery.example.com/driver/consents',
      },
    ]);
  });

  it('provides a local mock consent service for app flow development', async () => {
    const recordedAt = new Date('2026-05-12T06:20:00.000Z');
    const service = createMockDriverConsentService({ recordedAt });

    const result = await service.recordDriverConsents({
      appContext: null,
      consents: [
        { accepted: true, type: 'LOCATION_INFORMATION', version: 'location-v1' },
        { accepted: true, type: 'PERSONAL_INFORMATION', version: 'privacy-v1' },
      ],
      deviceContext: null,
      recordedAt,
      routeContext: 'route-context',
    });

    assert.equal(result.status, 'CONSENT_RECORDED');
    assert.equal(result.recordedAt, '2026-05-12T06:20:00.000Z');
  });
});
