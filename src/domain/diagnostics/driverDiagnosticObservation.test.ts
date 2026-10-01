import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DriverApiHttpError } from '../../api/deliveryServer/driverApiError';
import {
  captureDriverDiagnosticEmitter,
  captureDriverDiagnosticOperationObserver,
  createDriverDiagnosticRequestId,
  installDriverDiagnosticObserver,
  observeDriverDiagnosticOperation,
  type DriverDiagnosticObservation,
} from './driverDiagnosticObservation';

describe('driver diagnostic observation boundary', () => {
  it('reports a watchdog timeout without settling or aborting the business operation', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    let fireWatchdog: (() => void) | undefined;
    let settleBusiness: ((value: string) => void) | undefined;
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      setTimeout: (callback) => {
        fireWatchdog = callback;
        return 1;
      },
      clearTimeout: () => undefined,
    });

    const businessResult = observeDriverDiagnosticOperation({
      operation: 'AUTH_REFRESH',
      requestId: '11111111-1111-4111-8111-111111111111',
    }, () => new Promise<string>((resolve) => {
      settleBusiness = resolve;
    }));
    await Promise.resolve();

    assert.deepEqual(observations.filter((item) => item.kind === 'OPERATION').map(({ kind, phase }) => ({ kind, phase })), [
      { kind: 'OPERATION', phase: 'STARTED' },
    ]);
    fireWatchdog?.();
    assert.equal(observations[1]?.kind, 'OPERATION');
    assert.equal(observations[1]?.phase, 'WATCHDOG_TIMEOUT');
    assert.equal(observations[1]?.reasonCode, 'AUTH_REFRESH_TIMEOUT');

    settleBusiness?.('refreshed');
    assert.equal(await businessResult, 'refreshed');
    assert.equal(observations[2]?.kind === 'OPERATION' ? observations[2].phase : undefined, 'SUCCEEDED');
  });

  it('maps an initial HTTP failure to stable fields and preserves the thrown error', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    const expected = new DriverApiHttpError({
      code: 'ROUTE_NOT_IN_PROGRESS',
      endpoint: 'Driver event record',
      status: 409,
    });
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    await assert.rejects(
      observeDriverDiagnosticOperation({
        clientEventId: 'event-1',
        operation: 'EVENT_SEND',
        requestId: '22222222-2222-4222-8222-222222222222',
        routePlanId: 'route-1',
      }, async () => {
        throw expected;
      }),
      (error) => error === expected,
    );

    assert.deepEqual(observations.filter((observation) => observation.kind === 'OPERATION').map((observation) => ({
      clientEventId: observation.clientEventId,
      httpStatus: observation.httpStatus,
      kind: observation.kind,
      phase: observation.phase,
      reasonCode: observation.reasonCode,
      requestId: observation.requestId,
      routePlanId: observation.routePlanId,
    })), [
      {
        clientEventId: 'event-1', httpStatus: undefined, kind: 'OPERATION', phase: 'STARTED',
        reasonCode: undefined, requestId: '22222222-2222-4222-8222-222222222222', routePlanId: 'route-1',
      },
      {
        clientEventId: 'event-1', httpStatus: 409, kind: 'OPERATION', phase: 'FAILED',
        reasonCode: 'ROUTE_NOT_IN_PROGRESS', requestId: '22222222-2222-4222-8222-222222222222', routePlanId: 'route-1',
      },
    ]);
  });

  it('drops arbitrary error text and invalid identifiers at the observer boundary', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    await assert.rejects(observeDriverDiagnosticOperation({
      clientEventId: 'contains customer@example.com',
      operation: 'PROOF_UPLOAD',
      requestId: 'not-a-uuid',
      routePlanId: 'route-1',
    }, async () => {
      throw new Error('Bearer secret-token customer@example.com 43.6532,-79.3832');
    }));

    const serialized = JSON.stringify(observations);
    assert.equal(serialized.includes('secret-token'), false);
    assert.equal(serialized.includes('customer@example.com'), false);
    assert.equal(serialized.includes('43.6532'), false);
    assert.equal(serialized.includes('not-a-uuid'), false);
    assert.equal(observations[1]?.kind === 'OPERATION' ? observations[1].reasonCode : undefined, 'NETWORK_REQUEST_FAILED');
  });

  it('does not attribute late outcomes to a replacement observer', async () => {
    const oldObservations: DriverDiagnosticObservation[] = [];
    const newObservations: DriverDiagnosticObservation[] = [];
    let settleBusiness: (() => void) | undefined;
    installDriverDiagnosticObserver((observation) => { oldObservations.push(observation); }, {
      now: () => new Date('2026-10-01T14:04:03.000Z'),
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });
    const businessResult = observeDriverDiagnosticOperation({ operation: 'ROUTE_LOOKUP' }, () => new Promise<void>((resolve) => {
      settleBusiness = resolve;
    }));
    await Promise.resolve();

    installDriverDiagnosticObserver((observation) => { newObservations.push(observation); });
    settleBusiness?.();
    await businessResult;

    assert.deepEqual(oldObservations.filter((item) => item.kind === 'OPERATION').map((item) => item.phase), ['STARTED']);
    assert.deepEqual(newObservations, []);
  });

  it('drops captured task observations after the account observer changes', () => {
    const oldObservations: DriverDiagnosticObservation[] = [];
    const newObservations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { oldObservations.push(observation); });
    const emitForTask = captureDriverDiagnosticEmitter();

    installDriverDiagnosticObserver((observation) => { newObservations.push(observation); });
    emitForTask({
      clearReasonCodes: ['LOCATION_PIPELINE_TIMEOUT'],
      kind: 'STATE',
      patch: { locationTask: 'STARTED' },
    });

    assert.deepEqual(oldObservations, []);
    assert.deepEqual(newObservations, []);
  });

  it('runs a captured business operation without attributing it after the account changes', async () => {
    const oldObservations: DriverDiagnosticObservation[] = [];
    const newObservations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { oldObservations.push(observation); });
    const observeForAccount = captureDriverDiagnosticOperationObserver();
    installDriverDiagnosticObserver((observation) => { newObservations.push(observation); });

    const result = await observeForAccount({ operation: 'STORAGE_WRITE' }, async () => 'persisted');

    assert.equal(result, 'persisted');
    assert.deepEqual(oldObservations, []);
    assert.deepEqual(newObservations, []);
  });

  it('classifies storage rejection without copying disk error text', async () => {
    const observations: DriverDiagnosticObservation[] = [];
    installDriverDiagnosticObserver((observation) => { observations.push(observation); }, {
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    await assert.rejects(observeDriverDiagnosticOperation({ operation: 'STORAGE_WRITE' }, async () => {
      throw new Error('disk path and private account data');
    }));

    const failed = observations.find((item) => item.kind === 'OPERATION' && item.phase === 'FAILED');
    assert.equal(failed?.kind === 'OPERATION' ? failed.reasonCode : undefined, 'STORAGE_WRITE_FAILED');
    assert.equal(JSON.stringify(observations).includes('private account data'), false);
  });

  it('uses the installed strict UUID factory without exposing observer failures', async () => {
    installDriverDiagnosticObserver(() => {
      throw new Error('diagnostic sink failed');
    }, {
      requestIdFactory: () => '33333333-3333-4333-8333-333333333333',
      setTimeout: () => 1,
      clearTimeout: () => undefined,
    });

    assert.equal(createDriverDiagnosticRequestId(), '33333333-3333-4333-8333-333333333333');
    assert.equal(await observeDriverDiagnosticOperation({ operation: 'STORAGE_WRITE' }, async () => 'business-ok'), 'business-ok');
  });
});
