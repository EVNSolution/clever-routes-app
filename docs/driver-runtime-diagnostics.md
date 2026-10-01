# Driver runtime diagnostics 계약

앱 이슈: `EVNSolution/clever-routes-app#292`

변경 추적: `EVNSolution/clever-change-control#307`

이 문서는 CLEVER Routes 앱이 구현한 진단 계약과 서버가 구현해야 할 수신·판정 규칙을 정의한다. 앱 저장·전송 코드는 이 저장소에 구현되어 있지만, 아래 서버 endpoint와 운영 판정 화면이 현재 운영 서버에 배포됐다는 뜻은 아니다. `src/app/driverDiagnosticReceiverFixture.ts`는 계약 검증용 mock이며 운영 서버 구현이 아니다.

## 목적과 증거 경계

서버는 장애 시 다음 질문에 답할 수 있어야 한다.

1. 앱은 통신 중이지만 GPS 수집이 멈췄는가.
2. GPS callback과 수집은 계속되지만 처리·저장·전송이 멈췄는가.
3. 인증 또는 경로·세션 상태가 진행을 막았는가.
4. 서버가 요청을 받았지만 적용하지 못했거나, 적용 후 앱 ACK만 유실됐는가.
5. 앱 신호가 끊겨 현재 원인을 알 수 없는가.

서버는 관측되지 않은 원인을 추정하지 않는다. 마지막 신호가 오래됐다는 사실만으로 앱 종료, force-stop, 네트워크 단절, 배터리 절전 또는 OS 제한 중 하나를 원인으로 확정하지 않는다. 기기에서 뒤늦게 재생된 과거 기록은 과거 장애 설명에 사용하되 현재 건강 상태를 정상으로 만들지 않는다.

프로토콜 시각은 ISO 8601 UTC 값으로 교환·저장한다. 운영 화면과 장애 보고서에서는 이 시각을 `America/Toronto`로 변환해 표시하며, 화면에 시간대 이름 또는 offset을 함께 표시한다.

## 기존 heartbeat와의 관계

기존 `PUT /driver/sync-health` heartbeat는 route bearer, 업무 queue, route session과 연결된 기존 계약으로 유지한다. 신규 진단 채널은 같은 `sync-health` 영역에 속하지만 다음 이유로 별도 endpoint, credential, SQLCipher DB를 사용한다.

- 일반 route/account 인증 갱신이 멈춘 동안에도 이미 발급된 진단 credential로 오류를 보낸다.
- 업무 이벤트/GPS queue 또는 업무 evidence DB의 저장 지연이 진단 저장과 전송을 막지 않는다.
- 진단 전송 실패가 배송 이벤트 순서나 GPS 처리 결과를 변경하지 않는다.
- 서버는 기존 heartbeat 채택률과 신규 진단 채택률을 별도로 확인할 수 있다.

## 인증 계약

### `POST /driver/sync-health/registrations`

앱은 유효한 driver account bearer가 있을 때 진단용 쓰기 credential을 등록한다.

요청:

```json
{
  "schemaVersion": 1,
  "deviceInstanceHash": "lowercase device hash"
}
```

응답:

```json
{
  "token": "opaque diagnostic write token",
  "expiresAt": "2026-10-02T14:00:00.000Z"
}
```

서버 요구사항:

- token은 driver account, tenant, driver, `deviceInstanceHash`에 묶는다.
- 권한은 진단 등록 갱신과 `sync-health:write`로 제한한다. 배송 조회·변경, 경로 takeover, 고객정보 조회 권한을 주지 않는다.
- 최대 수명은 24시간이다. 앱은 만료까지 30초 이하이거나 수명이 24시간을 넘는 credential을 사용하지 않는다.
- 로그아웃·계정 폐기·기기 credential 폐기 시 서버에서 철회할 수 있는 식별자와 감사 기록을 둔다.
- account bearer 또는 진단 token을 진단 payload, 일반 로그, 오류 문자열에 복사하지 않는다.

앱은 진단 credential을 계정 hash별 SecureStore key에 저장한다. 계정 hash는 기기 내부 partition key이며 registration/diagnostics body에 보내지 않는다.

### `POST /driver/sync-health/diagnostics`

`Authorization: Bearer <diagnostic write token>`과 `Cache-Control: no-store`를 사용한다. 서버는 인증에 성공한 요청의 수신 시각을 서버 clock으로 별도 기록한 뒤 payload 검증·적용 결과를 기록한다.

성공 응답:

```json
{
  "acceptedDiagnosticIds": ["record UUID"],
  "serverReceivedAt": "2026-10-02T14:00:05.000Z"
}
```

- `diagnosticId`는 계정·기기 범위에서 멱등 처리한다. 같은 ID와 같은 payload 재전송은 중복 적용하지 않고 같은 acceptance를 반환한다.
- 같은 ID의 다른 payload는 거부하고 보안·계약 오류로 기록한다.
- `batchId`도 요청 추적과 응답 유실 대조에 보존한다.
- `acceptedDiagnosticIds`에는 실제로 영속 수락한 ID만 넣는다. 앱은 요청 batch에 없던 ID를 ACK로 소비하지 않는다.
- 인증은 됐지만 JSON/schema/영속화/판정 적용에 실패한 요청도 `lastContactAt`과 ingestion failure를 구분해 남긴다. 이를 정상 수락으로 표시하지 않는다.

## envelope v1

앱의 `DriverDiagnosticEnvelope`는 다음 구조다.

```ts
type DriverDiagnosticEnvelope = {
  schemaVersion: 1;
  batchId: string;                 // UUID
  bootId: string;                  // process boot UUID
  sentAt: string;                  // client send time
  discardedRecordCount: number;   // retention/coalescing으로 제거된 수
  liveContext: DriverDiagnosticContext;
  liveSnapshot: DriverDiagnosticSnapshot;
  records: DriverDiagnosticRecord[];
};
```

한 batch는 최대 50개 record 또는 직렬화 기준 64 KiB다. `records`는 오프라인·오류·상태 변경 이력이고 `liveSnapshot`은 전송 직전 현재 투영이다. 서버는 오래된 record의 `observedAt`과 현재 snapshot의 `snapshotObservedAt`을 혼동하지 않는다.

### context

```ts
type DriverDiagnosticContext = {
  appVersion: string;
  versionCode: number | null;
  os: 'ANDROID' | 'IOS';
  osVersion: string;
  deviceInstanceHash: string;
  routePlanId: string | null;
  sessionGeneration: string | null;
  assignmentGeneration?: string | null;
};
```

`routePlanId`는 UUID 또는 null이다. `sessionGeneration`은 canonical decimal, UUID, ISO timestamp 또는 null이며 기존 저장 session identity와 일치해야 한다. `assignmentGeneration`은 canonical decimal string이다. 현재 진단 `sessionGeneration`은 active route session의 `startedAt`(없으면 `updatedAt`)이며, 기존 heartbeat가 자체 생성하는 session generation과 동일한 값이라고 가정하지 않는다. 두 채널은 동일한 canonical `deviceInstanceHash`를 공유한다. 앱 버전 번호는 설치된 binary 식별 단서이며 그 자체로 소스 SHA를 증명하지 않는다.

### snapshot

snapshot은 다음을 포함한다.

- lifecycle: `FOREGROUND | BACKGROUND | INACTIVE | UNKNOWN`
- network: `ONLINE | OFFLINE | UNKNOWN`
- 위치 권한: `DENIED | GRANTED_ALWAYS | GRANTED_FOREGROUND | UNKNOWN`
- 위치 서비스: `DISABLED | ENABLED | UNKNOWN`
- 위치 task: `ERROR | EXPECTED | STARTED | STOPPED | UNKNOWN`
- `locationTaskExpected`: 현재 route 상태상 위치 task가 실행돼야 하는지 여부
- `lastGpsCallbackAt`, `lastGpsCollectedAt`, `lastGpsPersistedAt`
- `lastGpsSendAttemptAt`, `lastGpsSendAcknowledgedAt`
- 업무 queue의 `queueDepth`, `oldestQueuedAt`, 계산된 `oldestAgeMs`, `retryCount`, `nextRetryAt`
- 단계별 stable blocker와 선택적 HTTP status, client event ID, request ID

live snapshot의 blocker는 최근 최대 10개다. 이벤트별 blocker는 `clientEventId`로 구분하므로 다른 이벤트의 성공이 기존 실패를 지우지 않는다. 같은 이벤트의 같은 사유가 반복되면 `since`를 유지하고, 사유·단계가 바뀌면 새 관측 시각부터 표시한다. 전체 오류 이력은 별도 record에 남되 아래 보존 한도가 적용된다.

`snapshotObservedAt`은 snapshot 생성 시각이다. `stateObservedAt`은 lifecycle, network, 위치 권한·서비스·task 각각을 마지막으로 실제 관측한 시각이다. 값이 `UNKNOWN`이거나 관측이 없으면 해당 관측 시각은 null일 수 있다. 업무 queue에도 별도 `observedAt`이 있으므로 오래된 queue projection을 현재 사실로 취급하지 않는다.

### record

```ts
type DriverDiagnosticRecord = {
  diagnosticId: string;  // UUID
  bootId: string;
  sequence: number;     // 같은 process boot에서 route/계정 rebind를 거쳐도 증가
  observedAt: string;
  kind: 'HEARTBEAT' | 'STATE_CHANGE' | 'ERROR';
  context: DriverDiagnosticContext;
  snapshot: DriverDiagnosticSnapshot;
  identifiers?: { clientEventId?: string; requestId?: string };
};
```

정상 foreground heartbeat는 약 60초 간격이다. 상태 변경과 오류는 발생 시 immediate 전송을 요청하지만 최소 5초 전송 간격으로 합쳐진다. 전송 timeout 기본값은 10초이며 실패 시 jitter를 포함한 지수 backoff를 사용하고 최대 약 5분으로 제한한다. foreground/online 전환과 유효한 account 인증 복구는 즉시 재시도를 요청한다. 인증 실패로 계정 저장이 정리되는 경우에는 업무 처리를 기다리게 하지 않고 마지막 진단을 최대 15초 동안 전송한 뒤 분리한다. 일반 인증 실패 중에는 유효한 쓰기 전용 진단 credential로 AUTH 상태를 계속 보고할 수 있지만, 신규 계정 로그인과 명시적 clear는 이전 관측 범위를 분리한다.

백그라운드에서는 OS가 일반 JavaScript timer 실행을 보장하지 않는다. 위치 task callback과 실제 상태·오류 관측은 즉시 record를 만들지만, process가 실행되지 않는 시간에 가상의 heartbeat를 만들지 않는다.

## 단계와 stable reason code

blocker 단계는 `AUTH`, `ROUTE`, `LOCATION`, `PROCESSING`, `STORAGE`, `TRANSPORT`다. 서버와 운영 화면은 자유 문자열 대신 아래 stable code와 HTTP status를 사용한다.

- 인증: `AUTH_CREDENTIAL_MISSING`, `AUTH_REFRESH_FAILED`, `AUTH_REFRESH_TIMEOUT`
- 경로·세션: `ROUTE_MISMATCH`, `SESSION_MISMATCH`, `ROUTE_NOT_IN_PROGRESS`, `ROUTE_ACCESS_REVOKED`
- 위치: `LOCATION_PERMISSION_DENIED`, `LOCATION_PERMISSION_STATUS_FAILED`, `LOCATION_SERVICES_DISABLED`, `LOCATION_SERVICE_STATUS_FAILED`, `LOCATION_TASK_NOT_STARTED`, `LOCATION_TASK_STATUS_FAILED`, `LOCATION_TASK_ERROR`, `LOCATION_TASK_START_FAILED`, `LOCATION_TASK_STOP_FAILED`, `LOCATION_CALLBACK_STALE`, `LOCATION_SNAPSHOT_FAILED`
- 처리·저장: `LOCATION_PIPELINE_TIMEOUT`, `LOCATION_PROCESSING_FAILED`, `STORAGE_OPERATION_TIMEOUT`, `STORAGE_WRITE_FAILED`, `DIAGNOSTIC_STORAGE_FAILED`
- 전송: `NETWORK_OFFLINE`, `NETWORK_REQUEST_FAILED`, `HTTP_TIMEOUT`, `HTTP_UNAUTHORIZED`, `HTTP_FORBIDDEN`, `HTTP_RATE_LIMITED`, `HTTP_CLIENT_ERROR`, `HTTP_SERVER_ERROR`, `HTTP_INVALID_RESPONSE`, `REQUEST_ABORTED`, `OPERATION_TIMEOUT`

서버는 알 수 없는 code를 임의 의미로 바꾸지 않고 계약 버전 불일치로 분리한다. 앱은 HTTP response body, URL query, JavaScript error message를 blocker reason으로 전송하지 않는다.

## 기기 저장과 replay

- 진단 record는 업무 evidence DB와 다른 `clever_driver_diagnostics_v1.db`에 저장한다.
- DB는 SQLCipher를 요구하며 plaintext fallback이 없다.
- 256-bit DB key와 진단 credential은 device-only SecureStore에 보관하고, 첫 unlock 이후 백그라운드 task에서 접근할 수 있게 한다.
- record primary key는 `(accountOwnerHash, diagnosticId)`이며 append는 멱등이다.
- ACK 삭제는 같은 account partition의 수락된 ID만 대상으로 한다.
- 보존 한도는 계정별 7일, 최대 1,000건이다. 정상 heartbeat는 최신 상태 중심으로 coalesce하며 제거 수를 `discardedRecordCount`로 알린다.
- 저장된 payload도 read 시 계약 parser를 다시 통과한다. 손상되거나 허용되지 않은 row는 전송하지 않는다.

진단 DB append/read/remove는 5초로 제한된다. 저장이 실패하거나 늦어도 record는 process memory outbox에 남고 네트워크 전송은 계속된다. 원래 native DB 초기화 Promise가 timeout 뒤에 완료되면 같은 cache가 자동으로 사용 가능해진다. native open 자체가 영구 정지한 경우에는 process 안에서 무제한 재오픈하지 않는다. 이런 경우 네트워크 진단은 저장 timeout blocker를 보낼 수 있지만, process가 종료되기 전 DB에 쓰지 못한 memory record의 재실행 후 replay는 보장할 수 없다. 서버는 이 상황도 관측된 저장 실패 이상으로 확대 해석하지 않는다.

## 서버 판정 순서

서버는 `lastContactAt`, 최신 live snapshot, record history, server event attempt를 서로 다른 증거로 저장한다. 권장 판정 순서는 다음과 같다.

| 순서 | 판정 | 필요한 증거 | 금지되는 추론 |
| --- | --- | --- | --- |
| 1 | `SIGNAL_ABSENT_UNKNOWN` | 서버 clock 기준 마지막 authenticated contact가 임계값보다 오래됨 | 앱 종료 또는 네트워크 단절로 원인 확정 |
| 2 | `UNKNOWN_STALE_EVIDENCE` | 현재 contact는 있으나 `snapshotObservedAt` 또는 핵심 field 관측 시각이 오래됨 | replay record로 현재 HEALTHY 판정 |
| 3 | `SERVER_RECEIVED_NOT_APPLIED` | 같은 `clientEventId`/request ID의 서버 attempt가 `FAILED` 또는 `REJECTED` | client timeout만으로 서버 미적용 판정 |
| 4 | `SERVER_APPLIED_CLIENT_ACK_UNKNOWN` | server attempt가 `APPLIED`/`DUPLICATE`이고 client ACK 시각은 없음 | 이벤트 재적용 또는 queue 강제 삭제 |
| 5 | `AUTH_OR_ROUTE_BLOCKED` | fresh AUTH/ROUTE blocker | 익명 401을 특정 기사 요청으로 단정 |
| 6 | `GPS_POST_COLLECTION_BLOCKED` | GPS callback/collection은 fresh이고 PROCESSING/STORAGE/TRANSPORT blocker 또는 후속 단계 시각 정지 | 좌표가 없다는 이유로 GPS 미수집 단정 |
| 7 | `GPS_COLLECTION_STOPPED` | 통신과 snapshot은 fresh, `locationTaskExpected=true`, callback/collection이 임계값보다 오래됨 | `locationTaskExpected`가 false/unknown일 때 장애 판정 |
| 8 | `HEALTHY` | 위 blocker가 없고 GPS callback·collection·send ACK와 queue 관측이 모두 fresh이며 queue가 비어 있음 | 수집만 성공했거나 단일 heartbeat가 수신됐다는 이유로 전체 정상 판정 |

수집 증거만 있고 저장·전송 완료 증거가 충분하지 않으면 `UNKNOWN_INSUFFICIENT_EVIDENCE`다. 위치 수집을 기대하는 신규 boot/route/session에는 첫 서버 접촉 이후 관측 유예를 적용하며, 확인되지 않은 정지 시작 시각을 만들어내지 않는다. 기기 시각이 허용 오차보다 미래인 경우도 `UNKNOWN_STALE_EVIDENCE`로 분리한다.

임계값은 서버 설정으로 버전 관리한다. 계약 mock은 설명용 기본값으로 contact와 snapshot freshness에 각각 2분을 사용하지만, 이 값은 운영 승인값이 아니다.

모든 authenticated request는 현재 통신 증거이므로 replay 수신도 `lastContactAt`을 서버 수신 시각으로 갱신한다. 다만 replay의 오래된 `observedAt`은 현재 단계 상태를 바꾸지 않는다. 서버는 `serverReceivedAt`, client `sentAt`, snapshot `snapshotObservedAt`, record `observedAt`, 업무 event 발생 시각을 별도 열로 보존한다.

④ 판정에는 서버 자체 attempt가 필요하다. 기존 event attempt가 추적하지 않는 GPS 종류가 있다면 GPS ingestion에도 request/client identity와 수신·적용 결과를 추가해야 한다. 앱 blocker만 보고 서버 미적용을 판정하지 않는다.

## 개인정보와 비밀정보 제한

허용 필드는 위 계약에 열거된 값뿐이다. 다음 값은 진단 payload와 운영 diagnostic log에 포함하지 않는다.

- account/route/diagnostic bearer token과 refresh token
- PIN, 전화번호, 이메일, 이름, 주소, 배송 메모, 고객·주문 payload
- 원시 위도·경도, 사진, 서명, proof media URL
- HTTP request/response body, authorization header, 자유 형식 오류 문자열

route ID, session/assignment generation, client event ID, request ID는 서버 attempt와 대조하기 위한 제한된 식별자로 허용한다. 서버 조회 권한과 보관 정책은 tenant/driver 범위로 제한한다. device hash와 계정 hash를 원래 전화번호로 역조회하는 기능을 만들지 않는다.

## 서버 구현 및 운영 화면 최소 요건

서버는 최소한 다음 값을 조회할 수 있어야 한다.

- tenant/driver/device별 `lastContactAt`, 최신 snapshot 관측 시각, 앱/build, OS
- 현재 판정, 판정 시작 시각, stable blocker와 stage
- GPS callback→collection→persistence→send attempt→client ACK 시각
- queue depth/oldest/retry/next retry와 해당 queue 관측 시각
- route/session/assignment identity와 client event/request identity
- server ingestion/apply attempt status와 실패 code
- 과거 record replay 여부와 live snapshot freshness

운영 화면은 “현재 원인 미상”을 정상적인 판정으로 지원해야 한다. 신호 두절 row에는 `원인: UNKNOWN`, 마지막 서버 수신 Toronto 시각, 마지막 fresh snapshot Toronto 시각을 함께 보여준다.

## 완료 검증

서버 구현과 앱 연동이 완료됐다고 판단하려면 다음 fault를 실제 계약으로 재현한다.

1. 위치 callback 중단과 권한 철회: 통신은 유지되고 `GPS_COLLECTION_STOPPED` 또는 명시적 LOCATION blocker가 시작 시각과 함께 보인다.
2. GPS 처리·업무 DB 저장 hang/error: callback/collection은 계속되고 `GPS_POST_COLLECTION_BLOCKED`와 STORAGE/PROCESSING reason이 보인다. 진단 POST는 계속된다.
3. route account refresh hang/401 및 route/session mismatch: 일반 인증 갱신을 기다리지 않고 cached 진단 credential로 AUTH/ROUTE blocker를 보낸다.
4. 서버 `FAILED/REJECTED`: 같은 client event/request attempt와 조인되어 `SERVER_RECEIVED_NOT_APPLIED`가 된다.
5. 서버 `APPLIED` 후 HTTP 응답 유실: 같은 ID 재전송은 duplicate이고 `SERVER_APPLIED_CLIENT_ACK_UNKNOWN`과 client queue 잔류를 구분한다.
6. offline 후 복구: 기기 SQLCipher backlog가 자동 replay되고 과거 record가 최신 건강 상태를 덮지 않는다.
7. process kill/force-stop: 서버는 임계값 이후 `SIGNAL_ABSENT_UNKNOWN`만 표시하며 원인을 확정하지 않는다.
8. privacy fixture/fuzz: 토큰, PIN, 고객정보, 좌표, 임의 오류 문자열이 parser·영속 row·서버 저장·운영 로그에 들어가지 않는다.
9. 계정 전환·로그아웃: 이전 account partition의 record/credential이 새 계정 request에 섞이지 않는다.
10. background/잠금 상태: 첫 unlock 후 위치 callback record가 별도 진단 DB에 저장되고 복구 시 replay된다. OS가 process 실행을 허용하지 않은 구간은 UNKNOWN으로 남는다.

검증 증거는 앱 단위 테스트, server 계약/통합 테스트, 실제 배포 runtime revision, 실제 기기 fault injection을 구분해 남긴다. 앱 source test만으로 운영 서버 수신이나 실제 기기 background 동작을 완료로 보고하지 않는다.

## 배포 순서

1. 서버 migration, registration/diagnostics endpoint, 멱등 수신, attempt join, 조회 projection을 먼저 구현한다.
2. 서버 fixture에서 구버전 앱의 기존 heartbeat가 그대로 동작함을 확인한다.
3. 테스트 tenant/device에서 diagnostic credential 발급과 fault matrix를 검증한다.
4. 신규 앱 binary를 배포하고 version/build별 수신률과 privacy rejection을 확인한다.
5. 운영 임계값과 경보를 단계적으로 활성화한다. 초기에는 `UNKNOWN`과 stale evidence 비율을 함께 관찰한다.

서버 endpoint가 배포되기 전에 앱을 활성화하면 진단 전송은 backoff하며 로컬 record를 보존하지만 운영 판정은 생기지 않는다. 따라서 서버 수신·조회 준비가 앱 배포보다 먼저다.

## 서버 구현 인계

대상: `clever-route-server/apps/delivery-api`. 현재 앱 변경에는 서버 저장소 수정이나 운영 배포가 없다.

서버 작업에서는 이 계약의 credential 발급·계정/기기 권한 제한, batch 수신·멱등 영속화, 서버 수신 시각과 단계 관측 시각 분리, request/event join, GPS 수신/적용 증거, UNKNOWN을 포함한 운영 조회를 구현한다. 업무 bearer 실패를 진단 bearer 실패와 혼동하지 않으며, tenant/driver 범위는 account 인증 및 실제 route 소유 관계로 검증한다. 실제 수신기에서 위 fault matrix를 통과하기 전까지 운영 완료로 표시하지 않는다. 배포와 운영 데이터 수정은 별도 작업이다.
