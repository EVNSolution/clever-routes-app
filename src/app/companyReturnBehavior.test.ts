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

  it('enforces the route end mode for manual completion and route switching', () => {
    const source = readFileSync(appRootPath, 'utf8');
    const completionRequest = source.slice(
      source.indexOf('async function requestRouteCompletion'),
      source.indexOf('async function finishActiveRouteForSwitch'),
    );
    const routeSwitch = source.slice(
      source.indexOf('async function finishActiveRouteForSwitch'),
      source.indexOf('async function finishRoute'),
    );

    assert.match(completionRequest, /captureTrustedRouteEventLocation/u);
    assert.match(completionRequest, /classifyRouteCompletionLocation/u);
    assert.match(completionRequest, /completionLocation === 'confirmed' \|\| completionLocation === 'not_required'/u);
    assert.match(completionRequest, /finishUnverified/u);
    assert.match(completionRequest, /const confirmedAt = new Date\(\)/u);
    assert.match(completionRequest, /captureTrustedRouteEventLocation\(route\.id, confirmedAt\)/u);
    assert.match(completionRequest, /finish\(confirmedAt, confirmedLocation\)/u);
    assert.match(routeSwitch, /if \(!hasRemainingStops\) \{[\s\S]*requestRouteCompletion/u);
  });

  it('localizes the company return controls and missing-depot guidance', () => {
    assert.deepEqual(getCompanyReturnCopy('ko-KR'), {
      body: '모든 배송을 완료했습니다. 회사로 복귀해 경로를 종료할 때까지 위치 추적이 계속됩니다.',
      continueReturn: '계속 복귀',
      finish: '경로 종료',
      finishUnverified: '복귀 미확인으로 종료',
      missingDepot: '회사 복귀 위치를 확인할 수 없습니다. 경로를 종료하기 전에 배차 담당자에게 문의하세요.',
      navigate: '회사로 길안내',
      title: '회사로 복귀',
      unverifiedBody: '현재 위치가 회사 도착 범위 안인지 확인되지 않았습니다. 계속 복귀하거나, 필요한 경우 위치 미확인 상태로 경로를 종료하세요.',
      unverifiedTitle: '회사 복귀 미확인',
    });
    assert.equal(getCompanyReturnCopy('en-CA').finish, 'Finish Route');
    assert.deepEqual(getCompanyReturnCopy('ko-KR', false), {
      body: '모든 배송을 완료했습니다. 경로 종료를 누르면 위치 추적이 종료됩니다.',
      continueReturn: '계속 복귀',
      finish: '경로 종료',
      finishUnverified: '복귀 미확인으로 종료',
      missingDepot: '',
      navigate: '',
      title: '경로 완료',
      unverifiedBody: '',
      unverifiedTitle: '',
    });
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
