export const DRIVER_FLOW_STATES = [
  'unidentified',
  'route_context_entered',
  'company_context_confirmed',
  'invited',
  'consent_required',
  'consent_recorded',
  'route_ready',
  'delivery_active',
  'delivery_finished',
] as const;

export type DriverFlowState = (typeof DRIVER_FLOW_STATES)[number];

export type InitialAccessValidationInput = {
  routeContext?: string | null;
  phoneE164: string;
};

export type InitialAccessValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'phone_required' | 'phone_invalid';
    };

export type DeliveryActiveGuardInput = {
  state: DriverFlowState;
  hasLocationPermission: boolean;
};

export type MvpScenarioScreenId =
  | 'login'
  | 'routeList'
  | 'routeDetail'
  | 'navigation'
  | 'stopProof';

export type MvpScenarioScreen = {
  id: MvpScenarioScreenId;
  title: string;
  purpose: string;
  primaryAction: string;
};

export type MvpRouteTab = {
  id: 'active' | 'completed' | 'upcoming';
  label: '배송완료' | '배송전' | '배송중';
};

export type StopCompletionProofField = {
  id: 'locationTip' | 'photo' | 'todayNote';
  label: string;
  required: boolean;
};

const ROUTE_REVEAL_STATES = new Set<DriverFlowState>([
  'consent_recorded',
  'route_ready',
  'delivery_active',
  'delivery_finished',
]);

const E164_PHONE_PATTERN = /^\+[1-9]\d{7,14}$/;

export function getInitialAccessValidation({
  phoneE164,
}: InitialAccessValidationInput): InitialAccessValidationResult {
  if (phoneE164.trim().length === 0) {
    return { ok: false, reason: 'phone_required' };
  }

  if (!E164_PHONE_PATTERN.test(phoneE164.trim())) {
    return { ok: false, reason: 'phone_invalid' };
  }

  return { ok: true };
}

export function canRevealRouteDetails(state: DriverFlowState): boolean {
  return ROUTE_REVEAL_STATES.has(state);
}

export function canEnterDeliveryActive({
  state,
  hasLocationPermission,
}: DeliveryActiveGuardInput): boolean {
  return state === 'route_ready' && hasLocationPermission;
}

export function getMvpScenarioScreens(): MvpScenarioScreen[] {
  return [
    {
      id: 'login',
      title: '로그인',
      purpose: 'Confirm the driver by phone, then collect name and required consent.',
      primaryAction: '전화번호 확인',
    },
    {
      id: 'routeList',
      title: '내용',
      purpose: 'Show assigned routes grouped into 배송전, 배송중, and 배송완료 tabs.',
      primaryAction: '라우트 선택',
    },
    {
      id: 'routeDetail',
      title: '라우트 상세',
      purpose: 'Show company information, route date, region, and ordered stops before delivery starts.',
      primaryAction: '배송 시작',
    },
    {
      id: 'navigation',
      title: '내비게이션',
      purpose: 'Guide the driver through company pickup and each delivery stop in fixed order.',
      primaryAction: '다음 목적지로 이동',
    },
    {
      id: 'stopProof',
      title: '도착지 처리',
      purpose: 'Collect required photo proof and optional driver notes/tips at each stop.',
      primaryAction: '배송완료 증빙',
    },
  ];
}

export function getMvpRouteTabs(): MvpRouteTab[] {
  return [
    { id: 'upcoming', label: '배송전' },
    { id: 'active', label: '배송중' },
    { id: 'completed', label: '배송완료' },
  ];
}

export function getStopCompletionProofFields(): StopCompletionProofField[] {
  return [
    { id: 'photo', label: '배송완료 사진', required: true },
    { id: 'todayNote', label: '금일 배송시 특이사항', required: false },
    { id: 'locationTip', label: '배송지의 특성 팁', required: false },
  ];
}
