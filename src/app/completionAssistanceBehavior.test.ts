import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { it } from 'node:test';

it('keeps the confirmation inbox outside the selected-route and active-GPS screens', () => {
  const source = readFileSync(new URL('./AppRoot.tsx', import.meta.url), 'utf8');
  assert.match(source, /screen === 'completionAssistance'/);
  assert.match(source, /<CompletionAssistancePanel/);
  assert.match(source, /completionAssistance\.recordManualResponse/);
  assert.match(source, /completionAssistance\.endTracking/);
  assert.match(source, /completionAssistance\.returnIntent/);
  assert.match(source, /Finish route and stop GPS/);
  assert.doesNotMatch(source, /setCompletedStopIds\(routeSession\.route\.stops\.map/);
  assert.match(source, /locationInferredStopIds\.includes\(stop\.deliveryStopId\) \? 'Location inferred · review'/);
  assert.match(source, /if \(inferred\) return \{ label: 'Location inferred', tone: 'warning' \}/);
  assert.match(source, /onOpenInferred=\{\(\) => setScreen\('completionAssistance'\)\}/);
  assert.match(source, /locationInferredStopIds\.includes\(stop\.deliveryStopId\) \? onOpenInferred\(\) : onOpenStop\(stop\)/);
});

it('records candidates in the headless GPS task before live GPS submission', () => {
  const source = readFileSync(new URL('../platform/expo/location/expoContinuousLocationStreamService.ts', import.meta.url), 'utf8');
  const record = source.indexOf('await recordExpoCompletionLocations(');
  const send = source.indexOf('taskResult = await processContinuousLocationTaskBatch(');
  assert.ok(record >= 0 && record < send);
  assert.match(source, /synchronizeCompletionAssistance/);
  assert.ok(source.indexOf('await syncCompletionAfterGps?.()') > send);
  assert.match(source, /validateCurrent: isCompletionSessionCurrent/);
});

it('opens and consumes notification responses only for a restored candidate owned by the current account', () => {
  const hook = readFileSync(new URL('./useCompletionAssistance.ts', import.meta.url), 'utf8');
  const notifications = readFileSync(new URL('../platform/expo/notifications/expoCompletionAssistanceNotifications.ts', import.meta.url), 'utf8');
  assert.match(hook, /notificationOwner !== owner/);
  assert.match(hook, /saved\.candidates\.some\(\(candidate\) => candidate\.candidateId === candidateId\)/);
  assert.match(notifications, /candidateId: candidate\.candidateId, accountOwnerHash/);
  assert.match(notifications, /if \(await onPress\(candidateId, accountOwnerHash\) && active\)/);
});
