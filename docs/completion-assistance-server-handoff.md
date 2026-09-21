# 배송 완료 보완: 서버 계약 및 전달 프롬프트

앱 이슈: EVNSolution/clever-routes-app#288 / change-control #295. 이 문서는 **제안 계약**이며 현재 운영 API의 존재를 뜻하지 않는다. 앱 구현은 `src/domain/completion/completionAssistance.ts`, `completionAssistanceSync.ts`의 타입과 파서를 따른다.

## 현행 계약과 별도 구현이 필요한 이유

- `GET /driver/assigned-route`: 현재 route bearer의 전체 배송지를 제공하나 종료·취소 경로는 조회에서 제외된다.
- `/driver/events`: 기존 enum에는 방문 후보·아직 미완료·추정 정정이 없다. `LOCATION_UPDATED`와 명시적 STOP_DELIVERED/STOP_FAILED는 그대로 유지한다.
- 현재 ordered v2 identity는 string `assignmentGeneration`, `expectedRouteVersionId`, routePlanId 및 clientEventId다. 과거 저장 큐 schema v1은 driver API v1을 의미하지 않는다.
- `/driver/event-receipts/:routePlanId/:clientEventId`와 같이 계정 bearer로 종료 후에도 요청할 수 있는 별도 경로가 필요하다. route 토큰 유효 기간/당일 배정 목록에 후보 수명을 묶지 않는다.

## Wire 계약 v1

동일한 `/driver/completion-assistance`에 GET/POST를 사용한다. 인증은 `Authorization: Bearer <driver_account token>`, 응답은 `Cache-Control: no-store`다. 서버는 account→shop/driver→운행/배차/배송지의 실제 권한을 확인한다. client가 보낸 계정 hash는 요청에 없으며 local partition 용도다.

GET 응답:

```ts
{
  contractVersion: 1,
  serverTime: string, // ISO timestamp
  runs: CompletionRun[],
  candidates: CompletionCandidate[]
}
```

`CompletionRun`: 서버가 발급한 `runId`, `routePlanId`, string `assignmentGeneration`, `expectedRouteVersionId`, 선택 `routeName`, `policy`, `stops[]`, 선택 `trackingEndedAt`.

`stops[]`: `deliveryStopId`, 정확한 `coordinates: {latitude,longitude}|null`, `status`, 선택 `label`. 앱 현재 화면과 관계없이 그 운행의 모든 배송지를 제공한다. 불명확한 주소를 임의 도로 snapped point로 대체해 확정 방문으로 보지 않는다. `manualResponse`는 앱의 미전송 수동 완료 보호 표식이며 서버 권한으로 신뢰하지 않는다.

`policy`: 아래 모든 필드가 필요하며 앱은 운영 기본값을 갖지 않는다.

```ts
{
  version: string,
  maxAccuracyMeters: number,
  enterRadiusMeters: number,
  exitRadiusMeters: number, // enterRadius보다 큼
  dwellMs: number,
  maxGapMs: number,
  minDwellSamples: number, // 3 이상
  ambiguityRadiusMeters: number
}
```

정책 관계는 `maxAccuracyMeters < enterRadiusMeters < exitRadiusMeters`, `ambiguityRadiusMeters >= enterRadiusMeters`, `maxGapMs <= dwellMs`를 만족해야 한다. 탐색값 50m/100m/60초/200m는 운영 승인값이 아니다. 서버 정책 변경 시 version을 바꾸며 앱의 진행 중 체류를 끊는다. 같은 route에 active run을 둘 이상 반환하지 않는다. 종료 후 미처리 후보와 정정 가능한 후보, 해당 run의 이력도 반환한다. 취소/재배차는 authoritative candidate invalidation과 함께 반환한다.

`CompletionCandidate`의 필수 필드:

- `candidateId`, `runId`, `routePlanId`, `assignmentGeneration`, `expectedRouteVersionId`, `deliveryStopId`
- `arrivalAt`, `dwellCompletedAt`, `exitAt`, `policyVersion`
- `evidence: {latitude,longitude,accuracyMeters,occurredAt}[]` (최대 64개; 불완전한 근거는 held)
- `status: awaiting_response | responded | inferred_completed | held | invalidated`, `revision` (처음 0)

선택 필드: `routeName`, `stopLabel`, `response: completed | failed | not_completed`, `responseAt`, `responseDeadlineAt`, `autoCompletedAt`, `holdReason`. inferred_completed는 deadline과 autoCompletedAt이 필수이며 autoCompletedAt≥deadline이어야 한다. `notified`는 앱의 로컬 claim 필드로 서버는 이를 실제 표시/열람 증거로 사용하지 않는다. 서버는 후보 생성 요청의 status/revision/알림 필드 등을 신뢰하지 않고 검증 후 자체 projection을 만든다.

POST 요청:

```ts
{ contractVersion: 1, command: CompletionCommand }
```

명령 종류:

| kind | 필수 필드 | 의미 |
| --- | --- | --- |
| candidate | commandId, candidate, occurredAt (=exitAt) | client 감지 방문의 불변 근거 업로드; 서버 검증 후 등록 |
| response | commandId, candidateId, runId, routePlanId, assignmentGeneration, expectedRouteVersionId, deliveryStopId, response, occurredAt, expectedRevision | 명시적 완료/실패/아직 미완료 또는 기존 추정의 정정 |
| return_intent | commandId, runId, routePlanId, assignmentGeneration, expectedRouteVersionId, occurredAt | 복귀 내비 실행 의사; stop/route 자동 완료를 하지 않음 |

commandId와 candidateId는 길이가 있는 불투명한 문자열이며 UUID만을 요구하지 않는다. 앱은 동일 명령을 같은 ID로 재전송한다. response의 revision은 optimistic 순서이므로 같은 후보에 쌓인 여러 응답은 생성 순서대로 처리한다. 가게 복귀가 반복 실행되어도 배송 결과에 영향이 없어야 한다.

ACK (applied/duplicate/rejected 모두 body를 해석할 수 있는 2xx):

```ts
{
  contractVersion: 1,
  commandId: string, // 요청 ID와 정확히 같음
  status: 'applied' | 'duplicate' | 'rejected',
  candidate?: CompletionCandidate, // 해당 명령의 동일 candidate/운행/배차/배송지
  reason?: string // 안정된 코드, 개인정보 제외
}
```

response conflict에는 현재 authoritative candidate/revision을 반환한다. applied/duplicate response는 결과 candidate를 반환하는 것을 권장한다. 원자적 unique command receipt와 결과를 같은 transaction으로 저장한다. 서버 응답 유실 재시도는 최초 적용을 반복하지 않는다. 비2xx/timeout/깨진 JSON/잘못된 ACK는 앱이 명령을 소비하지 않는다. 404/501은 기능 미지원 의미이며 앱은 감지를 끄고 남은 근거·응답을 보존한다.

## 서버 판정 및 예외

1. 서버가 근거 시각/정확도/연속성/좌표/배정 membership을 검증한다. 다른 계정·배차의 GPS, 단순 통과, 한 점, 큰 gap, 저정확도, 같은 건물 식별 불능, 누락된 근거는 held 또는 거부한다. device 시각을 무조건 신뢰하지 않고 서버 수신시각/기존 GPS 이벤트와 비교한다.
2. `responseDeadlineAt = verified exitAt + 24시간`을 한 번 정한다. 다른 배송지 버튼/마지막 앱 접속/복귀 내비로 갱신하지 않는다. 최초 업로드가 이미 deadline을 지난 경우 미전송 응답 가능성이 있으므로 즉시 자동 처리하지 말고 late_upload hold로 검토한다.
3. worker는 deadline 도달, 무응답, 같은 배차, 수동 terminal/취소 없음, 양질 근거를 DB transaction/lock 안에서 재확인한다. unique outcome과 audit를 저장한 뒤에만 `inferred_completed`로 투영한다. raw 근거, 추정 방문·이탈 시각, 서버 자동 처리 시각을 구분해 보존한다.
4. 명시적 STOP_DELIVERED/STOP_FAILED, candidate response, 취소/재배차를 worker보다 우선한다. 수동 실패/취소를 추정 완료로 덮지 않는다. 아직 미완료는 해당 후보를 종료하며 타 후보 deadline에 영향이 없다. 새 방문은 새 candidateId로 별도 판단한다.
5. offline 응답은 서버가 받기 전에는 알 수 없다. 늦게 도착한 명시적 응답은 같은 배차의 위치 추정보다 우선하도록 정정한다. expectedRevision 차이가 서버 자동 추정 때문에만 생겼다면 무한 conflict로 막지 말고 명시적 응답을 적용한다. 다른 명시적 응답·새 배차와의 진짜 충돌은 현재 상태와 함께 rejected로 반환한다.
6. correction은 동일 response 명령으로 처리하되 이전 결과/행위자/사유/서버시각을 append-only audit에 남긴다. 원래 수동 완료·실패나 새 배차를 오래된 후보로 덮지 않는다. Shopify 원본 Order/Customer는 수정하지 않는다.
7. 기존 ROUTE_COMPLETED는 운행 상태만 종료하며 배송지를 일괄 완료하지 않는다. 닫힌 경로에도 계정 인증을 통해 후보 업로드·응답·정정이 가능해야 한다. 후보 worker가 GPS 수집 지속을 요구해서는 안 된다.
8. 앱이 생성한 후보의 확인 알림은 앱 local notification이 소유한다. 같은 후보에 server push를 추가하지 않는다. outcome 알림이 필요하면 별도 unique outcome key로 중복을 막는다. 후보 creation/retry 자체가 고객 완료 알림을 발송하면 안 된다.
9. 서버는 보관기한과 정정 가능 기간을 명시한다. 앱은 미전송/불확실 근거를 시간만으로 삭제하지 않는다. 계정 삭제와 운영 지원 export 정책도 맞춘다.

## 서버 검증 기준

- fake clock으로 deadline 직전/경계/직후, 다른 stop 응답에 의한 deadline 불변
- 수동 완료·실패·취소·재배차와 worker 경합, 여러 worker/retry의 exactly-once outcome
- 후보 및 response commit 후 HTTP 응답 유실, 중복 commandId, 다른 payload로 ID 재사용 거부
- offline 명시 응답이 자동 추정보다 우선하는 정정 및 서버 후보 revision 회복
- 앱/경로 종료 후 다음 날 계정 인증 요청, 다른 계정/shop/배송지 차단
- GPS 한 점·통과·저정확도·gap·시간 역전·미래·동일 건물·근거 초과 보류
- return_intent가 stop과 route 상태를 바꾸지 않음; route 종료가 후보를 지우지 않음
- Shopify 원본 데이터 불변; 명시적 실패는 OTHER 등 실제 의미를 가진 실패 분류 사용
- South 사건은 DriverEvent/DriverEventAttempt, 영속 큐/ACK/앱 버전을 함께 대조. 완료 이벤트 부재만으로 버튼 미조작을 결론 내리지 않음

## 복사할 프롬프트

대상 디렉터리: `/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-route-server`

```text
배송 완료 누락 보완용 서버 계약을 설계·구현해 주세요.
작업 디렉터리: /Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-route-server

앱 구현: EVNSolution/clever-routes-app issue #288, branch cc-295-completion-candidates, change-control #295 (root #145).
앱 문서 docs/completion-assistance-server-handoff.md와 src/domain/completion/completionAssistance.ts, completionAssistanceSync.ts의 wire contract v1을 먼저 읽어 주세요.

계정 bearer 기반 GET/POST /driver/completion-assistance를 제공하고, 서버 운행 ID/배차 generation/route version/전체 배정 배송지 및 버전 있는 방문 정책을 내려 주세요. 앱은 후보/응답을 SQLCipher에 먼저 저장하고 같은 commandId로 재시도하며, 서버 미지원 시 기능이 비활성입니다.

접근→연속 체류→이탈 근거를 검증한 후보에 한해 exitAt+24시간을 서버가 판정합니다. 명시적 완료/실패/아직 미완료, 수동 이벤트, 취소와 배차 변경이 우선입니다. 저정확도·gap·단순 통과·동일 건물 식별 불능·늦은 업로드는 자동 처리를 보류하세요. 자동 완료는 위치 추정으로 구분하고 근거/추정 방문/자동 처리 시각 및 정정 이력을 남기세요. offline 응답은 동기화 시 추정보다 우선하도록 정정하세요.

후보/command/outcome/알림의 idempotency와 transaction 경합을 보장하고, 가게 복귀 의사·운행/GPS 종료·후보 24시간 대기를 분리하세요. 운행 종료 후에도 기존 계정의 후보 응답/정정 API를 허용하되 새 배차와 타 계정/shop을 차단하세요. 기존 driver-event receipt와 수동 상태 전이를 재사용하고, Shopify 원본 주문/고객은 변경하지 마세요.

현행 완료 누락 원인 점검은 별도로 유지합니다. 앱 소스에서 발견한 send-before-durable 결함은 앱에서 수정했으나 South 실제 단말 원인으로 확정하지 않았습니다. 과거 배송 일괄 완료, 운영 배포, 스토어 제출, Shopify Tracking UI는 이번 서버 구현 범위에서 제외합니다.

완료 기준: 앱과 맞는 계약/fixtures, migrations, 서버 worker 및 lock/idempotency, 24시간 경계·offline/restart·명시적 응답 경합·정정·배차 변경·권한·GPS 보류 테스트, 문서와 service context 반영 필요성 검토. 운영 임계값은 탐색값을 그대로 채택하지 말고 정책 승인 상태를 명시하세요.
```
