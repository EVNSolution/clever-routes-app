import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import { getCompanyReturnCopy } from '../domain/route/companyReturnCopy';

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
    assert.match(routeSession, /companyReturnCopy\.title/u);
    assert.match(routeSession, /label=\{companyReturnCopy\.navigate\}/u);
    assert.match(routeSession, /label: companyReturnCopy\.finish[\s\S]*onPress: onFinishRoute/u);
  });

  it('localizes the company return controls and missing-depot guidance', () => {
    assert.deepEqual(getCompanyReturnCopy('ko-KR'), {
      body: '모든 배송을 완료했습니다. 회사로 복귀해 경로를 종료할 때까지 위치 추적이 계속됩니다.',
      finish: '경로 종료',
      missingDepot: '회사 복귀 위치를 확인할 수 없습니다. 경로를 종료하기 전에 배차 담당자에게 문의하세요.',
      navigate: '회사로 길안내',
      title: '회사로 복귀',
    });
    assert.equal(getCompanyReturnCopy('en-CA').finish, 'Finish Route');
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
