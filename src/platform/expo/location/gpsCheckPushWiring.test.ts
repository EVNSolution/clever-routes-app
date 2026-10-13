import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const stream = readFileSync(join(here, 'expoContinuousLocationStreamService.ts'), 'utf8');
const notifications = readFileSync(join(here, '..', 'notifications', 'expoStopArrivalNotificationService.ts'), 'utf8');

describe('GPS check push wiring', () => {
  it('handles the push in the background notification task and the foreground listener', () => {
    assert.match(notifications, /backgroundData\?\.type === GPS_CHECK_PUSH_TYPE[\s\S]*handleGpsCheckPushData\(backgroundData\)[\s\S]*BackgroundNotificationTaskResult\.NewData/u);
    assert.match(notifications, /addNotificationReceivedListener[\s\S]*GPS_CHECK_PUSH_TYPE[\s\S]*handleGpsCheckPushData\(/u);
  });

  it('uses the started active route, the background consent and the stored push state', () => {
    const handler = stream.slice(stream.indexOf('export async function handleGpsCheckPushData('));
    assert.match(handler, /activeRouteSession\.status === 'active'/u);
    assert.match(handler, /getBackgroundPermissionsAsync\(\)/u);
    assert.match(handler, /decideGpsCheck\(\{[\s\S]*lastHandled: readLastGpsCheck\(lastRaw\)/u);
    assert.match(handler, /GPS_CHECK_STATE_KEY, JSON\.stringify\(\{ at: Date\.now\(\), pushId: push\.pushId \}\)/u);
  });

  it('restarts a stopped task with a recorded reason and otherwise sends one position through the batch pipeline', () => {
    const handler = stream.slice(stream.indexOf('export async function handleGpsCheckPushData('));
    assert.match(handler, /decision\.action === 'restart_task'[\s\S]*LOCATION_TASK_NOT_STARTED[\s\S]*operation: 'START'/u);
    assert.match(handler, /getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.High \}\)[\s\S]*executeContinuousLocationTask\(\{ data: \{ locations: \[position\] \}, error: null \}\)/u);
    assert.doesNotMatch(handler, /scheduleNotificationAsync|showOperationalDialog/u);
  });
});
