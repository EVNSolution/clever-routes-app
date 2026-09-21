# 배송 완료 보완: 서버 계약 및 전달 프롬프트

앱 이슈: EVNSolution/clever-routes-app#288 / change-control #295. 이 문서는 **제안 계약**이며 현재 운영 API의 존재를 뜻하지 않는다. 앱 구현은 `src/domain/completion/completionAssistance.ts`, `completionAssistanceSync.ts`의 타입과 파서를 따른다.

## 현행 계약과 별도 구현이 필요한 이유

- `GET /driver/assigned-route`: 현재 route bearer의 전체 배송지를 제공하나 종료·취소 경로는 조회에서 제외된다.
- `/driver/events`: 기존 enum에는 방문 후보·아직 미완료·추정 정정이 없다. `LOCATION_UPDATED`와 명시적 STOP_DELIVERED/STOP_FAILED는 그대로 유지한다.
- 현재 ordered v2 identity는 `1..9223372036854775807` 범위의 canonical 10진 문자열 `assignmentGeneration`(선행 0/부호 없음), UUID `expectedRouteVersionId`, routePlanId 및 clientEventId다. 과거 저장 큐 schema v1은 driver API v1을 의미하지 않는다.
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

`CompletionRun`: 서버가 발급한 `runId`, `routePlanId`, string `assignmentGeneration`, `expectedRouteVersionId`, 선택 `routeName`, `policy`, `stops[]`, 선택 `trackingEndedAt`. `runId`는 최소 `(routePlanId, assignmentGeneration, expectedRouteVersionId)` identity마다 새로 발급하고 account/shop/driver/assignment/version 소유권을 불변으로 저장한다. 같은 배차 generation에서 재정렬·재최적화로 route version만 바뀌어도 새 run을 만들며 기존 run의 version을 덮어쓰지 않는다. 이전 version의 후보는 무효화하고 감사 이력을 보존한다.

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

시각의 의미: candidate command의 `exitAt`은 앱이 제안한 이탈 표본 시각이다. 서버는 원래 command payload/근거와 `proposedExitAt`을 불변 감사 자료로 보존하고 검증 결과 `verifiedExitAt`, 검증 시각/정책을 별도로 저장한다. ACK/GET의 `exitAt`은 서버가 승인한 이탈 시각이며 `responseDeadlineAt = verifiedExitAt + 86,400,000ms`다. 기존 GPS 근거로 같은 이탈 시각을 검증할 수 없거나 기기 시각 보정이 필요한 경우 자동추정 자격을 부여하지 말고 held 처리한다. raw 표본 시각을 덮어쓰거나 업로드 시각으로 deadline을 다시 시작하지 않는다. 서버는 과거 후보 재전송에도 해당 policy version의 임계값 스냅샷으로 검증한다.

선택 필드: `routeName`, `stopLabel`, `response: completed | failed | not_completed`, `responseAt`, `responseDeadlineAt`, `autoCompletedAt`, `holdReason`. 서버 ACK/GET의 `awaiting_response`는 검증된 deadline이 필수다. 아직 미동기화된 로컬 후보만 deadline을 생략할 수 있다. `inferred_completed`는 deadline과 autoCompletedAt이 필수이며 autoCompletedAt≥deadline이어야 한다. held/responded는 deadline을 생략할 수 있지만 제공한다면 같은 정확한 24시간 규칙을 따른다. `notified`는 앱의 로컬 claim 필드로 서버는 이를 실제 표시/열람 증거로 사용하지 않는다. 서버는 후보 생성 요청의 status/revision/알림 필드 등을 신뢰하지 않고 검증 후 자체 projection을 만든다.

POST 요청:

```ts
{ contractVersion: 1, command: CompletionCommand }
```

명령 종류:

| kind | 필수 필드 | 의미 |
| --- | --- | --- |
| candidate | commandId, candidate, occurredAt (=exitAt) | client 감지 방문의 불변 근거 업로드; 서버 검증 후 등록 |
| response | commandId, candidateId, runId, routePlanId, assignmentGeneration, expectedRouteVersionId, deliveryStopId, response, occurredAt, expectedRevision, 선택 previousResponseCommandId | 명시적 완료/실패/아직 미완료 또는 기존 추정의 정정 |
| return_intent | commandId, runId, routePlanId, assignmentGeneration, expectedRouteVersionId, occurredAt | 복귀 내비 실행 의사; stop/route 자동 완료를 하지 않음 |

commandId와 candidateId는 길이가 있는 불투명한 문자열이며 UUID만을 요구하지 않는다. 앱은 동일 명령을 같은 ID로 재전송한다. response의 revision은 optimistic 순서이므로 같은 후보에 쌓인 여러 응답은 생성 순서대로 처리한다. `previousResponseCommandId`는 같은 후보의 직전 미전송/미확인 응답 명령을 가리키는 선택 필드다. 앱은 생성 당시의 commandId, predecessor, payload를 재시도 중 변경하지 않는다. 서버는 이 인과 연결을 아래 규칙으로 검증하며 클라이언트 시각만으로 마지막 응답을 선택하지 않는다. 가게 복귀가 반복 실행되어도 배송 결과에 영향이 없어야 한다.

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

response conflict에는 현재 authoritative candidate/revision을 반환한다. applied/duplicate response는 그 명령의 적용 결과 authoritative candidate를 반드시 반환한다: `status=responded`, `response=command.response`, `responseAt=command.occurredAt`, `revision>command.expectedRevision`. `responseAt`은 원래 사용자 응답 시각을 보존하고 서버 수신·처리 시각은 별도 감사 필드에 기록한다. duplicate도 최초 적용 시 저장한 불변 receipt projection을 반환하며 이후 다른 응답으로 바뀐 현재 상태는 GET으로 제공한다. 앱은 이 결과가 누락되거나 명령과 불일치하는 성공 ACK를 소비하지 않는다. 원자적 unique command receipt와 결과를 같은 transaction으로 저장한다. 서버 응답 유실 재시도는 최초 적용을 반복하지 않는다. 비2xx/timeout/깨진 JSON/잘못된 ACK는 앱이 명령을 소비하지 않는다. 404/501은 기능 미지원 의미이며 앱은 감지를 끄고 남은 근거·응답을 보존한다.

## 서버 판정 및 예외

후보 테이블만 갱신해서는 완료 처리가 아니다. 후보 결과와 CLEVER 운영 `DeliveryStop.status`는 아래와 같이 같은 transaction에서 투영한다. Shopify 원본 Order/Customer는 이 투영의 대상이 아니다.

| 후보 처리 | CLEVER 배송지 결과 |
| --- | --- |
| 검증된 무응답 자동 추정 | `DELIVERED`, 출처 `LOCATION_INFERENCE`, 자동 처리 시각·근거 연결 |
| 명시적 `completed` | `DELIVERED`, 출처 `DRIVER_EXPLICIT`, 응답 명령·시각 연결 |
| 명시적 `failed` | `FAILED`, 기존 의미에 맞는 실패 사유(최소 `OTHER`), 응답 명령·시각 연결 |
| `not_completed` (아직 해당 후보의 terminal 결과 없음) | 기존 nonterminal 상태 유지, 이 후보 자동 추정만 종료 |
| `not_completed` 정정 (현재 terminal 결과가 이 후보 소유) | 최초 후보 terminal 처리 직전에 저장한 `statusBeforeCandidateOutcome`으로 복원 |

`statusBeforeCandidateOutcome`은 최초 후보 소유 terminal 전이 전에 저장한 `PENDING/ASSIGNED/EN_ROUTE/ARRIVED` 중 실제 이전 상태다. 정정 시 후보·outcome·마지막 명시 명령의 소유권과 revision을 CAS/lock으로 확인한다. 복원 근거가 없거나 현재 결과가 별도 수동 완료/실패·취소·재배차·다른 후보의 결과라면 상태를 추측해 되돌리지 않고 authoritative conflict로 거부한다. 이 후보의 인과적으로 연결된 응답 정정만 허용한다.

command receipt, candidate revision/result, stop projection, outcome/audit 및 기존 downstream outbox를 한 DB transaction에 묶는다. retry는 기존 결과를 재사용하고 새 완료 이벤트·고객 알림을 중복 발행하지 않는다. 정정은 기존 근거를 삭제하지 않고 별도 정정 outcome을 남기며 집계가 현재 결과와 일치하도록 한다. stop 정정으로 종료된 route를 다시 열거나 GPS를 다시 시작하지 않는다.

1. 서버가 근거 시각/정확도/연속성/좌표/배정 membership을 검증한다. 다른 계정·배차의 GPS, 단순 통과, 한 점, 큰 gap, 저정확도, 같은 건물 식별 불능, 누락된 근거는 held 또는 거부한다. 동일 건물/인접 주소 모호성은 이미 완료·실패·취소된 이웃을 포함한 해당 운행의 전체 배정 배송지를 기준으로 판단한다. device 시각을 무조건 신뢰하지 않고 서버 수신시각/기존 GPS 이벤트와 비교한다.
2. `responseDeadlineAt = verified exitAt + 24시간`을 한 번 정한다. 다른 배송지 버튼/마지막 앱 접속/복귀 내비로 갱신하지 않는다. 최초 업로드가 이미 deadline을 지난 경우 미전송 응답 가능성이 있으므로 즉시 자동 처리하지 말고 late_upload hold로 검토한다.
3. worker는 deadline 도달, 무응답, 같은 배차, 수동 terminal/취소 없음, 양질 근거를 DB transaction/lock 안에서 재확인한다. unique outcome과 audit를 저장한 뒤에만 `inferred_completed`로 투영한다. raw 근거, 추정 방문·이탈 시각, 서버 자동 처리 시각을 구분해 보존한다.
4. 명시적 STOP_DELIVERED/STOP_FAILED, candidate response, 취소/재배차를 worker보다 우선한다. 수동 실패/취소를 추정 완료로 덮지 않는다. 아직 미완료는 해당 후보를 종료하며 타 후보 deadline에 영향이 없다. 새 방문은 새 candidateId로 별도 판단한다.
5. offline 응답은 서버가 받기 전에는 알 수 없다. 늦게 도착한 명시적 응답은 같은 배차의 위치 추정보다 우선하도록 정정한다. expectedRevision 차이가 서버 자동 추정 때문에만 생겼다면 무한 conflict로 막지 말고 명시적 응답을 적용한다. 후속 offline 응답에 `previousResponseCommandId`가 있으면 그 receipt가 동일 계정·후보·운행·배차·버전의 applied/duplicate 응답인지, 현재 마지막 명시적 응답이 그 predecessor인지, 그 뒤 별도 수동 결과·취소·재배차가 없는지 transaction 안에서 확인한다. 이 조건을 모두 만족하는 인과적 후속 응답은 revision 숫자가 밀렸어도 적용한다. 다른 계정/후보의 ID, 거부된 predecessor, 다른 명시적 응답·수동 이벤트·새 배차와의 진짜 충돌은 현재 상태와 함께 rejected로 반환한다. 같은 commandId의 다른 payload는 허용하지 않는다.
6. correction은 동일 response 명령으로 처리하되 이전 결과/행위자/사유/서버시각을 append-only audit에 남긴다. 원래 수동 완료·실패나 새 배차를 오래된 후보로 덮지 않는다. Shopify 원본 Order/Customer는 수정하지 않는다.
7. 기존 ROUTE_COMPLETED는 운행 상태만 종료하며 배송지를 일괄 완료하지 않는다. 닫힌 경로에도 계정 인증을 통해 후보 업로드·응답·정정이 가능해야 한다. 권한은 운행 생성 시의 불변 account/driver/shop/assignment identity에 묶고 현재 RoutePlan.driverId만으로 과거 운행 소유권을 판단하지 않는다. 재배차된 예전 운행은 이력 조회만 허용하고 이전 후보 응답으로 새 배차를 변경하지 않는다. 후보 worker가 GPS 수집 지속을 요구해서는 안 된다.
8. 앱이 생성한 후보의 확인 알림은 앱 local notification이 소유한다. 같은 후보에 server push를 추가하지 않는다. 이탈+24시간 deadline은 알림 예약·표시·열람 ACK에 의존하거나 초기화되지 않는다. OS 표시를 보장할 수 없으므로 notified=true를 사용자에게 응답 기회가 보장됐다는 증거로 사용하지 않는다. outcome 알림이 필요하면 별도 unique outcome key로 중복을 막는다. 후보 creation/retry 자체가 고객 완료 알림을 발송하면 안 된다.
9. 서버는 보관기한과 정정 가능 기간을 명시한다. 앱은 미전송/불확실 근거를 시간만으로 삭제하지 않는다. 계정 삭제와 운영 지원 export 정책도 맞춘다.

## 서버 검증 기준

- fake clock으로 deadline 직전/경계/직후, 다른 stop 응답에 의한 deadline 불변
- 수동 완료·실패·취소·재배차와 worker 경합, 여러 worker/retry의 exactly-once outcome
- 후보 및 response commit 후 HTTP 응답 유실, 중복 commandId, 다른 payload로 ID 재사용 거부
- offline 명시 응답이 자동 추정보다 우선하는 정정 및 서버 후보 revision 회복
- 후보 결과와 실제 DeliveryStop/outcome/audit/receipt의 원자적 일치, rollback 후 부분 완료 없음
- inferred DELIVERED→not_completed는 저장된 실제 이전 nonterminal 상태로 복원; 별도 수동 terminal/취소/재배차 및 복원 근거 누락은 거부, 종료 route/GPS는 재개하지 않음
- candidate rev0 → 서버 inferred rev1 → offline completed(expected0) → failed(expected1, predecessor=completed command) 순서에서 최종 explicit failed, 양쪽 응답 유실/재시도에도 결과 중복 없음
- predecessor가 타 계정/후보, 거부됨, 현재 마지막 응답과 다름, 중간 수동 실패/취소/재배차가 있는 경우 차단
- accepted response ACK의 candidate/status/response/responseAt/진행된 revision 일치 및 duplicate receipt 불변; deadline은 exitAt+86,400,000ms 정확히 일치; 하루 경계는 달력 날짜가 아닌 경과시간
- 앱/경로 종료 후 다음 날 계정 인증 요청, 다른 계정/shop/배송지 차단
- GPS 한 점·통과·저정확도·gap·시간 역전·미래·동일 건물·근거 초과 보류
- return_intent가 stop과 route 상태를 바꾸지 않음; route 종료가 후보를 지우지 않음
- Shopify 원본 데이터 불변; 명시적 실패는 OTHER 등 실제 의미를 가진 실패 분류 사용
- South 사건은 DriverEvent/DriverEventAttempt, 영속 큐/ACK/앱 버전을 함께 대조. 완료 이벤트 부재만으로 버튼 미조작을 결론 내리지 않음

## 서버 우선 배포와 활성화 기준

1. 이전 앱과 호환되는 migration/API를 먼저 배포한다. 서버 배포와 추정 자동처리 활성화는 별도 상태다. 신규 운영 운행의 정책 제공 및 자동처리 worker는 기본 비활성으로 두고, 테스트 계정/운행으로 계약을 검증한다.
2. 서버 완료 증거에는 배포 commit와 실제 runtime SHA/image, migration 결과, 인증된 GET/POST fixture, 종료 운행의 응답·정정, 기존 수동 이벤트 회귀, worker disabled 상태를 남긴다. 소스 테스트만으로 배포 완료를 보고하지 않는다.
3. 배포된 서버와 Shopify용 CLEVER Routes 후보 앱을 연동하고 실제 기기에서 offline/restart/update·알림·응답/정정·GPS 종료를 검증한다. 그 이후 앱 배포를 진행한다. Shopify 관리자 Tracking UI는 별도 작업이다.
4. 운영 임계값과 적용 대상을 확정한 뒤 단계적으로 정책과 자동처리를 활성화한다. worker가 꺼져 있던 동안 생성된 후보를 활성화 순간 일괄 완료하지 않도록 서버가 run/candidate별 자동처리 자격과 활성화 시점을 별도로 기록한다. 자격이 없던 과거 후보는 held/명시적 응답 대상으로 보존하며 deadline을 새로 24시간으로 미루지 않는다.
5. rollback/kill switch는 추정 worker를 먼저 중지한다. 수동 완료, pending 응답, 원본 GPS, 감사 이력과 정정 API는 계속 보존한다. 기존 후보를 정정할 수 있도록 해당 run의 불변 identity와 유효한 과거 정책 정보를 반환한다. 미지원 서버로 rollback할 때도 404/501을 명시하고 앱의 미전송 명령을 유실시키지 않는다.

## 복사할 프롬프트

대상 디렉터리: `/Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-route-server`

```text
Shopify용 CLEVER Routes의 배송 완료 누락 보완 서버를 구현하고, 서버 우선 배포를 준비해 주세요.
작업 디렉터리: /Users/jiin/Documents/Files/03_Work_EVnSolution/01_Repos/04_CLEVER_Route/clever-route-server

앱 기준: EVNSolution/clever-routes-app PR #289 / issue #288 / branch cc-295-completion-candidates, change-control #295 (root #145). 최신 PR head의 docs/completion-assistance-server-handoff.md와 src/domain/completion/{completionAssistance.ts,completionAssistanceSync.ts}를 먼저 읽고 동일한 wire contract v1을 구현해 주세요. 기존 dirty 작업과 다른 서비스 범위는 보존하세요.

계정 bearer GET/POST /driver/completion-assistance, 불변 운행 account/driver/shop/배차 identity, canonical BigInt generation와 UUID route version, 전체 배정 배송지, 버전 있는 정책과 영속 후보/명령 receipt/worker를 구현하세요. 종료 운행도 본래 계정으로 응답·정정할 수 있어야 하며 예전 배차의 명령이 새 배차를 변경하면 안 됩니다.

접근→연속 체류→이탈을 검증한 후보만 다루고, 저정확도·gap·한 점·통과·동일 건물 모호성은 보류하세요. 모호성은 이미 완료·실패·취소된 이웃도 포함해 판단하세요. 50m/100m/60초/200m는 탐색값이며 운영 기본값으로 확정하지 마세요.

후보별 검증된 exitAt+24시간을 서버가 판단하며 다른 배송지 조작·복귀 내비·알림 예약/열람으로 초기화하지 마세요. 수동 완료·실패·취소·재배차 및 명시적 completed/failed/not_completed 응답이 우선입니다. 자동 완료는 위치 추정으로 구분하고 불변 근거, 추정 방문·이탈, 서버 자동 처리 시각과 정정 감사 이력을 남기세요.

후보 결과와 CLEVER DeliveryStop 상태를 receipt/outcome/audit와 같은 transaction에 반영하세요. completed/자동 추정은 출처를 구분한 DELIVERED, failed는 FAILED입니다. 같은 후보 소유 결과의 not_completed 정정은 저장해 둔 실제 이전 nonterminal 상태로 복원하되 별도 수동 결과·취소·재배차 또는 복원 근거 누락은 충돌로 처리하세요. 후보 테이블만 바꾸거나 닫힌 route/GPS를 다시 열면 안 됩니다.

offline 연속 응답의 previousResponseCommandId 인과 연결을 검증하세요. rev0 후보가 서버에서 inferred rev1이 된 뒤 completed(expected0), failed(expected1, predecessor=completed)가 도착해도 최신 명시 failed가 적용돼야 합니다. 선행 receipt/현재 마지막 명시 응답/불변 identity를 확인하고 중간 수동 결과·취소·재배차·다른 응답이 있으면 충돌로 처리하세요. accepted response ACK에는 해당 명령의 responded 상태·response·원래 responseAt·진행된 revision을 가진 authoritative candidate를 반드시 반환하고, 동일 commandId 재시도는 최초의 불변 receipt 결과로 처리하세요.

복귀 의사·운행/GPS 종료·후보 대기는 분리하세요. route 종료로 배송지를 일괄 완료하거나 GPS를 하루 더 수집하면 안 됩니다. 앱 local 알림과 중복되는 server push를 보내지 말고 고객 완료 알림도 후보 생성만으로 보내지 마세요. Shopify 원본 Order/Customer 및 관리자 Tracking UI는 변경하지 마세요.

fake clock의 24시간 경계, 동시 worker/수동 이벤트, 응답 유실/retry, 연속 offline 정정, 종료 운행, 재배차/타 계정 권한, 이미 terminal인 동일건물 이웃, GPS 품질 보류를 검증하세요. 기존 버튼 누락 점검은 독립 유지하며 South 사례의 서버 이벤트 부재로 버튼 미조작을 단정하지 마세요. 과거 배송 일괄 보정은 하지 마세요.

배포 순서는 서버 migration/API 배포(운영 정책·추정 worker 비활성) → 앱 연동/실기기 검증 → Shopify용 Routes 앱 배포 → 승인된 정책의 단계적 자동처리 활성화입니다. 비활성 기간 후보가 worker 활성화 순간 일괄 완료되지 않도록 eligibility를 기록하고 기존 deadline을 다시 시작하지 마세요. rollback 때도 명시적 응답·근거·정정 API는 보존하세요.

서버 작업에서 승인된 배포 범위에 따라 진행하고, 완료 보고에는 PR/merge SHA, 테스트, migration, 실제 runtime SHA/image, 인증 API 검증 및 worker 활성화 상태를 구분해 남겨 주세요. 배포가 미승인/미실행이면 배포 완료로 보고하지 마세요. 이번 요청으로 앱 배포·스토어 제출이나 과거 데이터 변경을 실행하지 마세요.
```
