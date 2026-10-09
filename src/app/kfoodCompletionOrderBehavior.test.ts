import { deliveryProofRequirements, validateDeliveryProof } from '../domain/proof/deliveryProofPolicy';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createContext, runInContext } from 'node:vm';
import ts from 'typescript';
import { sampleAssignedRoute, type AssignedRouteStop } from '../domain/route/assignedRoute';
import { buildOutOfOrderStopArrivalWarning, getNextIncompleteRouteStepIndex, getRouteReturnStepIndex, isStopCompleted } from '../domain/route/routeStepProgress';
import { buildCashCompletion, getSingleCompletionAction } from './kfoodSingleCompletion';
import type { OperationalDialogButton } from './OperationalDialog';
import type { StopProofEventInput } from '../domain/stop/stopProofEvents';

const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('AppRoot.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const handlers: string[] = [];
let cancelCashExpression = '';
function findHandlers(node: ts.Node): void {
  if (ts.isFunctionDeclaration(node) && ['handleRequestStopCompletion', 'handleConfirmCashCompletion', 'handleTerminalStop'].includes(node.name?.text ?? '')) handlers.push(node.getText(tree));
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'CashCompletionModal') {
    const cancel = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(tree) === 'onCancel');
    if (cancel !== undefined && ts.isJsxAttribute(cancel) && cancel.initializer !== undefined && ts.isJsxExpression(cancel.initializer)) {
      cancelCashExpression = cancel.initializer.expression?.getText(tree) ?? '';
    }
  }
  ts.forEachChild(node, findHandlers);
}
findHandlers(tree);
assert.equal(handlers.length, 3);
assert.notEqual(cancelCashExpression, '');

function harness(cashStopId?: string, deliveryProof?: {photoRequired: boolean; signatureRequired: boolean}) {
  const stops = ['A', 'B', 'C'].map((id, index) => ({ ...sampleAssignedRoute.stops[0]!, deliveryStopId: id, sequence: index + 1, status: 'ASSIGNED',
    payment: { method: id === cashStopId ? 'CASH' as const : 'ETRANSFER' as const, methodTitle: id === cashStopId ? 'Cash' : 'eTransfer',
      gatewayNames: [], financialStatus: 'PENDING', expectedAmount: '122.25', currencyCode: 'CAD', expectedAmountSource: 'SHOPIFY_OUTSTANDING' as const, requiresCashInput: id === cashStopId },
  }));
  const route = { ...sampleAssignedRoute, deliveryProof, id: 'route', stops };
  const session = { route, routeAccess: { assignmentGeneration: '2', expectedRouteVersionId: 'version', driverContractVersion: 2 } };
  const dialogs: { title: string; message: string; buttons: OperationalDialogButton[] }[] = [];
  const submissions: StopProofEventInput[] = [];
  const progress: { navigationStepIndex: number; completedStopIds: string[] }[] = [];
  const messages: string[] = [];
  let cashPopupCount = 0;
  let arrivalCount = 0;
  let cash: { key: string; stop: AssignedRouteStop; routePlanId: string; owner: string; generation: string; version: string } | null = null;
  const context = createContext({
    completionSubmissionRunningRef: { current: false }, isCompletingStop: false, isRefreshingRoutes: false, isCapturingPhoto: false, isStartingRoute: false,
    setIsStopDetailsInputFocused() {}, usesSingleCompletion: () => true, selectedRoute: route, selectedRouteSession: session,
    routeStatus: 'active', isCompanyStep: false, routeStartRecoveryState: 'idle', setMessage: (value: string) => messages.push(value),
    isStopCompleted, completedStopIds: [] as string[], getSingleCompletionAction, getStopReceipt: () => null, getPendingStopCompletion: () => null,
    navigationStepIndex: 1, currentStop: stops[0], buildOutOfOrderStopArrivalWarning,
    showOperationalDialog: (title: string, message: string, buttons: OperationalDialogButton[]) => dialogs.push({ title, message, buttons }),
    setCashInput: (value: typeof cash) => { if (value !== null) cashPopupCount += 1; cash = value; context.cashInput = value; }, setCashInputError() {},
    deliveryProofRequirements, validateDeliveryProof, signatureUris: {}, cashInput: cash, cashDrafts: {} as Record<string, string>, buildCashCompletion,
    recordStopArrival: () => { arrivalCount += 1; }, activateAndRecordStopArrival: () => { arrivalCount += 1; },
    blockMutationWhileStorageDegraded: () => false, pendingRoutePlanId: null, setPendingRoutePlanId() {}, deliveryStartResult: { kind: 'delivery_active' },
    routeProgressRefreshGuardRef: { current: { beginMutation: () => () => undefined } },
    driverSyncAccountEpochRef: { current: 1 }, driverSyncBoundAccountOwnerHashRef: { current: 'owner' },
    selectedRouteIdRef: { current: 'route' }, liveRouteSessionsRef: { current: [session] },
    proofPhotoResults: {}, proofMediaResults: {}, proofDrafts: {}, screenRef: { current: 'stopDetails' },
    setIsCompletingStop: (value: boolean) => { context.isCompletingStop = value; }, offlineSubmissionQueue: { getAccountOwnerHash: () => 'owner' },
    getProofDraft: () => ({}), formatStopProofNote: () => '', createRouteOrderedDriverEventService: () => ({}),
    getDriverEventServiceForCurrentSubmission: () => ({}), mockDriverEventService: {}, buildDriverAccessRefresh: () => undefined, submission: {}, runtimeConfig: {},
    Crypto: { randomUUID: () => '12345678-1234-4000-8000-123456789012' },
    recordStopProofEventAfterDeliveryStart: async (input: { input: StopProofEventInput }) => { submissions.push(input.input); return { kind: 'recorded' }; },
    setStopProofResults() {}, completionAssistance: { recordManualResponse: async () => undefined }, setRouteRecoveryRefreshReason() {},
    setRouteSessions() {}, setCompletedStopIds: (ids: string[]) => { context.completedStopIds = ids; }, setServerConfirmedStopIds() {}, setCompletedStopTimes() {},
    formatLocalCompletedTime: () => '12:00', getRouteReturnStepIndex, getNextIncompleteRouteStepIndex,
    driverAccessTokenStore: { saveActiveRouteSession: async (input: { navigationStepIndex: number; completedStopIds: string[] }) => { progress.push(input); return true; } },
    setNavigationStepIndex: (index: number) => { context.navigationStepIndex = index; }, openRouteStopDetails() {}, syncOfflineQueueState() {},
  });
  runInContext(ts.transpileModule(`var cancelCash = ${cancelCashExpression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  for (const handler of handlers) runInContext(ts.transpileModule(handler, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { context, dialogs, submissions, progress, messages, stops,
    get cash() { return cash; }, get cashPopupCount() { return cashPopupCount; }, get arrivalCount() { return arrivalCount; },
    request: (id: string) => context.handleRequestStopCompletion(stops.find(stop => stop.deliveryStopId === id)),
    confirmOrder: async () => { const confirm = dialogs.at(-1)?.buttons.find(button => button.style !== 'cancel'); assert.ok(confirm?.onPress); await confirm.onPress(); },
    cancelOrder: () => dialogs.at(-1)?.buttons.find(button => button.style === 'cancel')?.onPress?.(),
    cancelCash: () => context.cancelCash(),
    confirmCash: async (value: string) => { assert.ok(cash); context.cashDrafts[cash.key] = value; await context.handleConfirmCashCompletion(); },
  };
}

describe('single completion preserves the planned stop order boundary', () => {
  it('cancels future eTransfer without a submission, cash popup, or progress write', async () => {
    const app = harness();
    await app.request('B');
    assert.equal(app.dialogs.length, 1);
    app.cancelOrder();
    assert.equal(app.submissions.length, 0); assert.equal(app.cashPopupCount, 0); assert.equal(app.progress.length, 0);
    assert.equal(app.context.navigationStepIndex, 1); assert.equal(app.context.completedStopIds.length, 0); assert.equal(app.arrivalCount, 0);
  });
  it('confirms only future B and keeps incomplete A next instead of advancing to C', async () => {
    const app = harness();
    await app.request('B'); await app.confirmOrder();
    assert.deepEqual(app.submissions.map(event => event.deliveryStopId), ['B']);
    assert.equal(app.submissions[0]?.completion?.version, 1); assert.equal(app.arrivalCount, 0);
    assert.deepEqual(Array.from(app.context.completedStopIds), ['B']);
    assert.equal(app.context.navigationStepIndex, 1); assert.equal(app.progress[0]?.navigationStepIndex, 1);
  });
  it('submits current eTransfer once with no order confirmation or Cash popup', async () => {
    const app = harness(); await app.request('A');
    assert.equal(app.dialogs.length, 0); assert.equal(app.cashPopupCount, 0); assert.equal(app.arrivalCount, 0);
    assert.deepEqual(app.submissions.map(event => event.deliveryStopId), ['A']); assert.equal(app.context.navigationStepIndex, 2);
  });
  it('current Cash needs only the amount popup and preserves zero', async () => {
    const app = harness('A'); await app.request('A');
    assert.equal(app.dialogs.length, 0); assert.equal(app.cashPopupCount, 1); assert.equal(app.submissions.length, 0);
    await app.confirmCash('0');
    assert.equal(app.submissions[0]?.completion?.cashReceived?.amount, '0.00'); assert.equal(app.submissions.length, 1); assert.equal(app.arrivalCount, 0);
  });
  it('future Cash cancel opens no amount popup; confirming order alone does not complete', async () => {
    const app = harness('B'); await app.request('B'); app.cancelOrder();
    assert.equal(app.cashPopupCount, 0); assert.equal(app.submissions.length, 0); assert.equal(app.progress.length, 0);
    await app.request('B'); await app.confirmOrder();
    assert.equal(app.cashPopupCount, 1); assert.equal(app.submissions.length, 0); assert.equal(app.progress.length, 0);
    assert.equal(app.context.navigationStepIndex, 1);
    assert.ok(app.cash);
    const originalDraftKey = app.cash.key;
    app.context.cashDrafts[originalDraftKey] = '122';
    app.cancelCash();
    assert.equal(app.cash, null); assert.equal(app.context.cashDrafts[originalDraftKey], '122');
    assert.equal(app.submissions.length, 0); assert.equal(app.progress.length, 0); assert.equal(app.context.completedStopIds.length, 0);
    await app.request('B'); await app.confirmOrder();
    assert.equal(app.context.cashInput?.key, originalDraftKey); assert.equal(app.context.cashDrafts[originalDraftKey], '122');
    await app.confirmCash('122');
    assert.equal(app.submissions[0]?.completion?.cashReceived?.amount, '122.00');
    assert.deepEqual(Array.from(app.context.completedStopIds), ['B']); assert.equal(app.context.navigationStepIndex, 1); assert.equal(app.arrivalCount, 0);
  });
});


describe('configured proof shares the completion dialog', () => {
  it('requires photo and signature together with Cash without emitting an Arrived event', async () => {
    const app = harness('A', { photoRequired: true, signatureRequired: true });
    await app.request('A');
    assert.equal(app.cashPopupCount, 1);
    await app.confirmCash('122');
    assert.equal(app.submissions.length, 0);
    app.context.proofPhotoResults.A = { kind: 'captured', source: 'camera', uri: 'file:///photo.jpg' };
    await app.confirmCash('122');
    assert.equal(app.submissions.length, 0);
    app.context.signatureUris.A = 'file:///signature.png';
    await app.confirmCash('122');
    assert.equal(app.submissions.length, 1);
    assert.equal(app.submissions[0]?.completion?.cashReceived?.amount, '122.00');
    assert.equal(app.submissions[0]?.localMedia?.length, 2);
    assert.equal(app.arrivalCount, 0);
  });
  it('collects only required proof for eTransfer and sends no Cash amount', async () => {
    const app = harness(undefined, { photoRequired: false, signatureRequired: true });
    await app.request('A');
    assert.equal(app.cashPopupCount, 1);
    app.context.signatureUris.A = 'file:///signature.png';
    await app.confirmCash('');
    assert.equal(app.submissions.length, 1);
    assert.equal(app.submissions[0]?.completion?.cashReceived, undefined);
    assert.equal(app.submissions[0]?.localMedia?.length, 1);
    assert.equal(app.arrivalCount, 0);
  });
});
