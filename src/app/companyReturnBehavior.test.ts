import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const appRootPath = join(dirname(fileURLToPath(import.meta.url)), 'AppRoot.tsx');

describe('company return behavior', () => {
  it('persists the final stop and keeps tracking active until explicit Finish', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const completion = source.slice(
      source.indexOf('async function handleTerminalStop'),
      source.indexOf('async function finishActiveRouteForSwitch'),
    );
    const lastStop = completion.slice(completion.indexOf('const isLastStop'));

    assert.match(lastStop, /getRouteReturnStepIndex\(selectedRoute\)/u);
    assert.match(lastStop, /saveActiveRouteSession\(\{[\s\S]*completedStopIds: nextCompletedStopIds,[\s\S]*navigationStepIndex: returnStepIndex/u);
    assert.match(lastStop, /setNavigationStepIndex\(returnStepIndex\)/u);
    assert.doesNotMatch(lastStop, /finishRoute\(selectedRoute\)/u);
  });

  it('shows depot navigation and leaves completion on the explicit Finish action', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const routeSession = source.slice(
      source.indexOf('function RouteSessionScreen('),
      source.indexOf('function StopDetailsScreen('),
    );

    assert.match(source, /openDepotNavigation\(\{[\s\S]*depot: selectedRoute\.depot/u);
    assert.match(routeSession, />Return to Company</u);
    assert.match(routeSession, /label="Navigate to Company"/u);
    assert.match(routeSession, /label: 'Finish Route'[\s\S]*onPress: onFinishRoute/u);
  });

  it('restores the dedicated return step without clamping it back to the final stop', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const clamp = source.slice(
      source.indexOf('function clampRouteNavigationStepIndex('),
      source.indexOf('function getRouteStatus('),
    );

    assert.match(clamp, /getRouteReturnStepIndex\(route\)/u);
  });
});
