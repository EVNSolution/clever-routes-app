import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { buildAuthFailureMessage } from './authDiagnostics';
import { createDriverApiHttpError } from '../api/deliveryServer/driverApiError';
import { RouteAccessTransportError } from '../domain/routeAccess/routeAccess';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('AppRoot.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findNode(root: ts.Node, matches: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (found !== undefined) return;
    if (matches(node)) found = node;
    else ts.forEachChild(node, visit);
  };
  visit(root);
  assert.ok(found, 'Expected the production feedback branch to exist');
  return found;
}

function handler(name: string): ts.FunctionDeclaration {
  return findNode(tree, node => ts.isFunctionDeclaration(node) && node.name?.text === name) as ts.FunctionDeclaration;
}

function callback(root: ts.Node, name: string): string {
  const property = findNode(root, node => ts.isPropertyAssignment(node) && node.name.getText(tree) === name) as ts.PropertyAssignment;
  return property.initializer.getText(tree);
}

function catchHandler(root: ts.Node): string {
  const statement = findNode(root, node => ts.isTryStatement(node) && node.catchClause !== undefined) as ts.TryStatement;
  assert.ok(statement.catchClause);
  return `async (error) => ${statement.catchClause.block.getText(tree)}`;
}

function feedbackHarness(expression: string, overrides: Record<string, unknown> = {}) {
  const messages: (string | null)[] = [];
  const effects: string[] = [];
  const context = createContext({
    Error,
    setMessage: (message: string | null) => messages.push(message),
    routeStartDurablyCommitted: true,
    setRouteStartRecoveryState: (state: string) => effects.push(`recovery:${state}`),
    clearAndStopActiveLocationSession: async () => { effects.push('clear'); },
    routeSession: { route: { id: 'route-1' } },
    resetActiveRouteProgress: () => effects.push('reset'),
    screenRef: { current: 'routeSession' },
    requestScreen: 'mainTabs',
    setScreen: (screen: string) => effects.push(`screen:${screen}`),
    isRouteSwitch: true,
    isSkipped: false,
    setPendingRoutePlanId: () => effects.push('clear-switch'),
    routeSessionDeactivated: true,
    continuousLocationStreamService: { stopLocationUpdates: async () => { effects.push('stop-gps'); } },
    CONTINUOUS_LOCATION_TASK_NAME: 'location',
    setDeliveryStartResult: () => effects.push('clear-start'),
    ...overrides,
  });
  runInContext(ts.transpileModule(`var handleFeedback = ${expression};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  return { context, messages, effects };
}

const privateFailure = new Error('java.net.UnknownHostException: https://route.example.test/events HTTP 503');
function assertSafeFailure(messages: (string | null)[]): void {
  assert.equal(messages.length, 1);
  assert.match(messages[0] ?? '', /route|arrival|completion/iu);
  assert.doesNotMatch(messages[0] ?? '', /UnknownHostException|https?:|route\.example|HTTP|503/u);
}

describe('route action feedback', () => {
  it('shows offline refresh recovery without clearing login and preserves expired-login recovery', async () => {
    const routeLoadCatch = findNode(tree, node => ts.isCatchClause(node)
      && node.block.statements.some(statement => statement.getText(tree) === 'setRouteRecoveryCode(routeLoadStage);')) as ts.CatchClause;
    for (const isCurrent of [true, false]) {
      for (const error of [new RouteAccessTransportError(), createDriverApiHttpError({ endpoint: 'Route access lookup', status: 401 })]) {
        const app = feedbackHarness(`async (error) => ${routeLoadCatch.block.getText(tree)}`, {
          runtimeConfig: { mode: 'live', deliveryServerBaseUrl: 'https://route.example.test' },
          routeLoadStage: 'LR02', isLoginAccountCurrent: () => isCurrent, persistedActiveRouteSession: null,
          buildAuthFailureMessage, getLiveRouteLoadDiagnostic: () => ({}), console: { warn() {} },
        });
        app.context.setRouteRecoveryCode = (code: string) => app.effects.push(`recovery:${code}`);
        app.context.setRouteSyncState = (state: string) => app.effects.push(`sync:${state}`);
        app.context.clearInvoluntaryDriverSession = async (input: { clearAccess: () => Promise<void>; clearLocation: () => Promise<void> }) => {
          await input.clearAccess();
          await input.clearLocation();
        };
        app.context.driverAccessTokenStore = { clear: async () => { app.effects.push('clear-access'); } };
        app.context.resetRouteProgress = () => app.effects.push('reset-progress');
        app.context.setVerifiedDriverPhoneE164 = () => app.effects.push('clear-phone');
        await app.context.handleFeedback(error);
        if (!isCurrent) {
          assert.deepEqual(app.messages, []);
          assert.deepEqual(app.effects, []);
        } else if (error instanceof RouteAccessTransportError) {
          assert.deepEqual(app.messages, ['Routes could not refresh. Try again when connected.']);
          assert.deepEqual(app.effects, ['recovery:LR02', 'sync:error', 'screen:mainTabs']);
        } else {
          assert.deepEqual(app.messages, ['Your login expired. Sign in again with your phone number and PIN.']);
          assert.deepEqual(app.effects, ['recovery:LR02', 'clear-access', 'clear', 'reset-progress', 'clear-phone', 'screen:loginPhone', 'sync:idle']);
        }
      }
    }
  });

  it('keeps a durable route active without exposing the recovery error', async () => {
    const app = feedbackHarness(callback(handler('startRouteSessionAfterConfirmed'), 'recover'));
    await app.context.handleFeedback(privateFailure);
    assertSafeFailure(app.messages);
    assert.match(app.messages[0] ?? '', /active|Do not restart/u);
    assert.deepEqual(app.effects, ['recovery:sync_pending']);
  });

  it('keeps start rollback cleanup without exposing the underlying error', async () => {
    const app = feedbackHarness(callback(handler('startRouteSessionAfterConfirmed'), 'rollback'), {
      routeStartDurablyCommitted: false,
    });
    await app.context.handleFeedback(privateFailure);
    assertSafeFailure(app.messages);
    assert.deepEqual(app.effects, ['clear', 'reset', 'screen:mainTabs']);
  });

  it('keeps completion cleanup and does not claim that a possibly saved submission was lost', async () => {
    const app = feedbackHarness(catchHandler(handler('handleTerminalStop')));
    await app.context.handleFeedback(privateFailure);
    assertSafeFailure(app.messages);
    assert.doesNotMatch(app.messages[0] ?? '', /could not be saved|collect again/u);
    assert.deepEqual(app.effects, ['clear-switch']);
  });

  it('keeps Finish cleanup without exposing the underlying error or claiming GPS stopped', async () => {
    const app = feedbackHarness(catchHandler(handler('finishRoute')));
    assert.equal(await app.context.handleFeedback(privateFailure), false);
    assertSafeFailure(app.messages);
    assert.doesNotMatch(app.messages[0] ?? '', /GPS.*stopped/u);
    assert.deepEqual(app.effects, ['stop-gps', 'clear-start', 'screen:mainTabs']);
  });

  it('does not expose the arrival error', async () => {
    const arrival = findNode(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'recordStopArrival');
    const app = feedbackHarness(catchHandler(arrival));
    assert.equal(await app.context.handleFeedback(privateFailure), false);
    assertSafeFailure(app.messages);
  });

  it('removes routine arrival success feedback while preserving queued recovery details', async () => {
    const arrival = findNode(tree, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'recordStopArrival');
    const statement = findNode(arrival, ts.isTryStatement) as ts.TryStatement;
    const resultIndex = statement.tryBlock.statements.findIndex(item => item.getText(tree).startsWith('const result = await submitStopArrivalForRouteStop'));
    assert.ok(resultIndex >= 0);
    const feedback = statement.tryBlock.statements.slice(resultIndex).map(item => item.getText(tree)).join('\n');
    for (const action of ['add_proof', 'next_stop']) {
      for (const kind of ['recorded', 'queued']) {
        const recoveryMessage = 'Route ended on the server. Saved arrival needs reconciliation.';
        const app = feedbackHarness(`async () => { ${feedback} }`, {
          stop: { deliveryStopId: 'stop-1' }, routeSession: { route: { id: 'route-1' } }, arrivalEvidence: undefined,
          requestScreen: 'routeSession', returnScreen: 'routeSession', action,
          submitStopArrivalForRouteStop: async () => ({ kind, message: recoveryMessage }),
          setArrivalCheckReturnScreen() {}, setPendingStopArrivalCompletion() {}, STOP_ARRIVAL_NOTIFICATION_TYPE: 'arrival',
        });
        assert.equal(await app.context.handleFeedback(), true);
        if (kind === 'recorded') assert.deepEqual(app.messages, [null]);
        else assert.ok(app.messages[0]?.includes(recoveryMessage));
      }
    }
  });

  it('does not show technical ETA failure prose while keeping ready arrival estimates', () => {
    const routeScreen = handler('RouteSessionScreen');
    const showRows = findNode(routeScreen, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'showRouteEtaRows') as ts.VariableDeclaration;
    assert.ok(showRows.initializer);
    for (const status of ['READY', 'FAILED', 'PRE_PICKUP']) {
      const context = createContext({
        isPickupTask: false,
        etaSnapshot: { status, failureMessage: privateFailure.message },
      });
      assert.equal(runInContext(showRows.initializer.getText(tree), context), status === 'READY');
    }
    assert.doesNotMatch(routeScreen.getText(tree), /failureMessage/u);
  });

  it('keeps queued pickup feedback and auth recovery while removing the recorded success toast', async () => {
    const pickupHandler = handler('handleArrivedAtStep');
    const initialMessage = findNode(pickupHandler, node => ts.isVariableDeclaration(node) && node.name.getText(tree) === 'pickupMessage') as ts.VariableDeclaration;
    assert.ok(initialMessage.initializer);
    for (const result of [{ kind: 'recorded' }, { kind: 'queued' }, { kind: 'queued', requiresRouteLookup: true }]) {
      const reasons: string[] = [];
      const app = feedbackHarness(callback(pickupHandler, 'onDurablyCommitted'), {
        pickupStopLabel: 'Stop 1',
        selectedRoute: { id: 'route-1' },
        setRouteRecoveryRefreshReason: (reason: string) => reasons.push(reason),
      });
      app.context.pickupMessage = runInContext(initialMessage.initializer.getText(tree), app.context);
      await app.context.handleFeedback(result);
      if (result.kind === 'recorded') assert.equal(app.context.pickupMessage, null);
      else assert.match(app.context.pickupMessage, /saved on this device/iu);
      assert.doesNotMatch(app.context.pickupMessage ?? '', /while syncing/iu);
      assert.deepEqual(reasons, result.requiresRouteLookup ? ['driver_access_expired'] : []);
    }
  });

  it('keeps tracking restore failure scoped to the current account without exposing the native error', async () => {
    const trackingCatch = findNode(tree, node => ts.isCatchClause(node)
      && node.block.statements.some(statement => statement.getText(tree) === 'setContinuousLocationResult(null);')) as ts.CatchClause;
    for (const isCurrent of [true, false]) {
      const locationResults: unknown[] = [];
      const app = feedbackHarness(`async (error) => ${trackingCatch.block.getText(tree)}`, {
        isLoginAccountCurrent: () => isCurrent,
        setContinuousLocationResult: (result: unknown) => locationResults.push(result),
      });
      await app.context.handleFeedback(privateFailure);
      if (isCurrent) {
        assertSafeFailure(app.messages);
        assert.match(app.messages[0] ?? '', /route remains active/iu);
        assert.match(app.messages[0] ?? '', /refresh/iu);
        assert.deepEqual(locationResults, [null]);
      } else {
        assert.deepEqual(app.messages, []);
        assert.deepEqual(locationResults, []);
      }
    }
  });

  it('releases camera capture state and keeps native errors in diagnostics', async () => {
    const messages: string[] = [];
    const diagnostics: string[] = [];
    const captureStates: boolean[] = [];
    const app = feedbackHarness(handler('handleTakePhoto').getText(tree), {
      disabled: false, isTakingPhoto: false, isCameraReady: true,
      cameraRef: { current: { takePictureAsync: async () => { throw privateFailure; } } },
      onCaptured: () => assert.fail('A failed photo must not be submitted'),
      setIsTakingPhoto: (value: boolean) => captureStates.push(value),
      setCameraError: (message: string) => messages.push(message),
      console: { warn: (message: string) => diagnostics.push(message) },
    });
    await app.context.handleFeedback();
    assert.deepEqual(messages, ['Could not take this photo. Try again.']);
    assert.deepEqual(captureStates, [true, false]);
    assert.deepEqual(diagnostics, [`[proof-camera] ${privateFailure.message}`]);
  });

  it('shows a camera mount recovery action while retaining native diagnostics', async () => {
    const mountAttribute = findNode(handler('ProofCameraScreen'), node => ts.isJsxAttribute(node)
      && node.name.getText(tree) === 'onMountError') as ts.JsxAttribute;
    assert.ok(mountAttribute.initializer && ts.isJsxExpression(mountAttribute.initializer));
    assert.ok(mountAttribute.initializer.expression);
    const messages: string[] = [];
    const diagnostics: string[] = [];
    const app = feedbackHarness(mountAttribute.initializer.expression.getText(tree), {
      setCameraError: (message: string) => messages.push(message),
      console: { warn: (message: string) => diagnostics.push(message) },
    });
    await app.context.handleFeedback({ message: privateFailure.message });
    assert.deepEqual(messages, ['Camera could not start. Reopen the camera or use Gallery.']);
    assert.deepEqual(diagnostics, [`[proof-camera] ${privateFailure.message}`]);
  });
});
