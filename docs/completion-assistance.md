# 배송 완료 누락 보완 설계

연결: app #288 / change-control #295 / project-start #145. 앱 구현 범위이며 운영 배포·스토어 제출·과거 배송 변경은 제외한다.

## 현행과 증거 경계

현행 도착 알림은 `getStopArrivalNotificationCandidate`가 화면에서 선택한 배송지 반경 진입을 판단한다. 완료 후보와 같지 않다. 기존 완료 이벤트는 ordered driver-event queue와 SQLCipher evidence store를 사용한다. 수동 완료 경로, 마이그레이션, 저장 실패 및 ACK 처리는 후보 기능과 독립적으로 점검한다. 서버 이벤트 부재는 버튼 미조작의 증거가 아니다. South 사례의 GPS 방문 후보 14곳은 사용자가 제공한 탐색 결과이며 이 작업에서 실기기 저장소나 운영 DB를 조사한 결과가 아니다.

## 책임과 활성화

- 앱: 해당 운행의 전체 배송지에서 접근→연속 체류→이탈 감지, 암호화 영속 저장, 알림과 응답/정정 UI, 계정 범위의 재시도.
- 서버: 운행/배차 식별자와 버전이 있는 정책 제공, GPS 근거 검증, 후보별 이탈 시각+24시간 판정, 명시적 응답/수동 이벤트/취소/재배차 우선, 원자적 중복 제거, 추정 완료/정정 이력.
- 신규 계약을 지원하지 않는 서버에는 후보 기능을 활성화하지 않는다. 탐색 기준 50m/100m/60초/200m는 테스트 입력일 뿐 기본 운영값이 아니다.
- 후보와 응답은 기존 완료 이벤트와 별도로 보관한다. 운행 종료·로그아웃·배차 변경이 미전송 근거를 삭제하지 않는다. 다른 계정에서는 읽거나 전송하지 않는다.

## 상태 전이

1. `outside` → `dwelling`: 유효한 외부 접근 표본 후 진입. 정확도 오차를 고려해 진입 반경 안임이 확실해야 한다.
2. `dwelling` → `awaiting_response`: 정책의 최소 체류시간과 여러 연속 표본을 충족한 뒤 확실하게 이탈. 후보 ID는 운행·배차·배송지·방문을 포함하며 재처리해도 같아야 한다.
3. GPS 저정확도·끊김·미확정 좌표·같은 건물/겹치는 반경은 추정을 보류한다. 단일 표본/통과/중복/역순 표본으로 체류시간을 채우지 않는다.
4. `awaiting_response` → `responded`: 완료/실패/아직 미완료를 먼저 디스크에 저장한다. 아직 미완료는 해당 후보 자동완료를 막으며 다른 후보 타이머에는 영향을 주지 않는다.
5. 서버만 `awaiting_response` → `inferred_completed`를 수행한다. GPS 방문 시각, 이탈 시각, 서버 만료 시각과 자동 처리 시각을 분리한다.
6. `inferred_completed` → 명시적 정정: 버전과 멱등 명령 ID로 감사 이력을 남기고 명시적 상태로 전환한다.
7. 수동 terminal 상태·취소·재배차는 해당 후보 추정을 무효화한다. 오래된 응답으로 새 배차를 수정하지 않는다.

가게 복귀 내비 실행은 `return_intent`만 기록한다. 운행 종료 및 GPS 중지는 기존 명시적 종료 흐름을 사용하며 후보 24시간 대기와 분리한다.

## 검증 기준 (구현 전 고정)

- 정상 접근/체류/이탈, 화면 선택과 무관한 모든 배정 배송지, 정확도 오차, 단순 통과, 1점, 기록 간격, 동일/인접 건물, 중복/역순/미래 GPS.
- 후보별 고정된 이탈 시각, 다른 배송지 응답에 영향 없음, 명시적 응답 후 자동 완료 금지, 수동 terminal 상태와 배차 변경.
- 재시작 중 체류 복원, 후보/응답 디스크 저장 실패, 계정 격리, 중복 알림/ACK, 요청 성공 후 응답 유실 재시도, 정정 및 서버 상태 반영.
- 서버 미지원/잘못된 정책에서 비활성, 24시간 로컬 완료 없음, GPS 종료 후 후보 유지/재시도.
- 기존 완료/실패 버튼 및 offline evidence 관련 회귀 테스트를 독립 실행한다.
- 전체 workspace/lint/typecheck/Android+iOS JS export. 실기기 GPS·알림·업데이트/재부팅·실서버 24시간 처리는 별도 증거가 필요하다.

## 서버 전달

구체적인 wire 계약, 서버 검증 기준과 복사 가능한 프롬프트는 [서버 전달 문서](completion-assistance-server-handoff.md)에 있다. 서버 및 Shopify 저장소는 이 작업에서 수정하지 않는다.

## 앱 구현

- `src/domain/completion/completionAssistance.ts`: 순수 상태 전이. 화면 선택과 무관하게 서버가 허용한 운행의 전체 PENDING/ASSIGNED/EN_ROUTE/ARRIVED 배송지를 평가한다. 진입은 거리+정확도≤진입반경, 이탈은 거리−정확도≥이탈반경이다. GPS 간격·정책/배차 버전이 바뀌면 체류 근거를 끊는다. 최초 정책 수신 전에는 배차별 초기 GPS를 최대 120개·20분·2개 배차로 제한해 암호화 저장하고 정책 수신 후 재생한다. 운행 정책 수신 전 수동 완료·실패도 배차별로 보존해 오래된 PENDING 스냅샷으로 다시 후보가 되지 않게 한다. 각 방문의 최대 64개 근거를 보존하며 초과 시 자동 처리용 근거가 불완전한 `held` 후보로 남긴다.
- `completionAssistanceSync.ts`: 계정 bearer로 별도 후보 명령을 전송한다. 디스크의 명령을 먼저 전송하고 서버 스냅샷을 반영한다. 요청과 JSON 수신에 제한 시간을 적용한다. command ID가 다른 ACK, 잘못된 상태, 다른 운행/배송지의 ACK를 소비하지 않는다. 서버의 명시적 거부는 `held`와 사유로 남기고 사용자가 다시 확인할 수 있게 한다.
- `expoEncryptedEvidenceStore.ts`: 기존 SQLCipher DB/key 안에 additive 테이블 `completion_assistance_state`를 만든다. 계정 hash를 키로 한 exclusive transaction이 후보·체류·응답·알림 claim을 함께 보존한다. 기존 queue key와 schema version은 바꾸지 않는다. 손상/상위 스키마를 빈 상태로 덮지 않는다.
- `expoContinuousLocationStreamService.ts`: headless GPS task에서 기존 raw GPS HTTP 호출 전에 후보 근거를 저장한다. 후보 오류는 기존 GPS 송신을 막지 않는다. 기존 active session, 계정, 배차가 맞을 때만 판단한다.
- `useCompletionAssistance.ts`: 로그인한 계정의 후보를 복원하며 앱 복귀 및 foreground 60초 간격으로 동기화한다. 이 간격은 네트워크 재시도이며 24시간 판정 타이머가 아니다. 로그아웃은 요청을 취소하고 후보를 계정별로 보존한다. 계정 삭제 요청 전 미전송 명령을 확인하고 서버 삭제 접수 후 해당 계정의 로컬 후보 저장소를 제거한다.
- `CompletionAssistancePanel.tsx`: 경로 종료 후에도 접근하는 Delivery confirmations 화면. 후보별 완료/실패/아직 미완료, 서버 만료시각, 방문·이탈·자동처리 시각, 위치 추정 완료 구분 및 정정을 제공한다. 자동 추정 정정에는 바꾸려는 결과를 확인하는 대화상자가 있다. 경로 및 완료 목록에서도 위치 추정을 별도 배지/필터로 구분하고 해당 배송지에서 정정 목록으로 진입한다. 미전송 정정은 서버 ACK 전까지 추정 출처를 유지한다.
- 확인 화면의 복귀 내비는 intent만 기록한다. 최초 운행 동기화 전 의사는 배차별 최신 1건·최대 2개 배차로 보존하며, 일치하는 운행이 도착하면 종료된 운행도 명령으로 승격한다. 별도의 “Finish route and stop GPS”는 기존 durable route-end 경로를 재사용한다. 서버의 기존 ROUTE_COMPLETED 처리는 route 상태만 바꾸며 stop 상태를 바꾸지 않는다. 미완료 배송지 상태와 후보 대기는 유지한다.

## 알림과 장애 처리

알림 전에 후보와 일회성 알림 claim을 디스크에 저장한다. 같은 후보의 task replay/restart로 알림을 다시 예약하지 않는다. OS 알림과 SQLite는 원자적으로 commit할 수 없으므로 claim 직후 강제종료 또는 권한 거부 시 OS 알림이 표시되지 않을 수 있다. 이때 앱의 영속 확인 목록이 복구 경로다. 알림 탭은 현재 계정 owner hash와 복원된 후보 존재 여부가 맞을 때만 화면을 열고 소비한다. `notified`는 “예약 시도 claim”이지 실제 사용자 열람 증거가 아니다. 서버는 client 후보에 별도의 중복 push를 보내지 않는 계약을 따른다. 앱 알림의 예약·초기 응답·listener API는 [Expo Notifications 공식 문서](https://docs.expo.dev/versions/latest/sdk/notifications/)와 설치된 SDK 타입을 확인했다.

서버 미지원(404/501)에서는 후보 감지를 비활성화하고 기존 후보/응답은 보존한다. 운영 임계값 기본값이나 앱 자체 자동 완료는 없다. 서버가 이 계약과 정책을 제공하기 전 새 기능의 실운영 효과를 주장하지 않는다.

## 기존 완료 누락의 독립 점검

확인한 결함: `recordStopProofEventAfterDeliveryStart`는 서버 요청이 거부된 후에만 큐에 저장했다. 실제 AppRoot의 `createRouteOrderedDriverEventService` 래퍼도 사전에 저장하지 않았다. 네트워크 요청 대기 중 OS 종료·업데이트 재시작이 일어나면 완료/실패 의도가 디스크에 없을 수 있었다. 또 live 요청에 제한 시간이 없었다.

수정: 배차/버전 메타데이터와 하나의 clientEventId를 고정 → 큐 저장 및 저장 확인 → 최대 15초 live 시도 → 같은 ID의 확인된 ACK만 저장. 초기 저장 실패는 송신을 막고, timeout/오프라인은 동일 이벤트를 남기며, ACK 저장 실패는 재시작 후 기존 durable PENDING을 재시도한다. 실제 운영 래퍼를 사용한 테스트로 요청 대기 중 저장, 재시작/동일 ID, 저장 실패, ACK 쓰기 실패, timeout abort와 늦은 성공을 검증한다.

과거 소스 `424f351`에도 같은 경로가 존재함은 확인했으나 South 단말에 설치된 정확한 APK/SHA, 버튼 조작 여부, 그 시점의 SQLCipher DB/키·큐 상태는 확인하지 않았다. 따라서 이 결함은 가능한 누락 경로이며 해당 사건의 확정 원인이 아니다. 기존 저장소의 legacy migration, 손상 quarantine, SQLCipher 사용 불가/키 문제, downgrade 방지 테스트도 전체 회귀에 포함된다. 실기기 업데이트 보존 검증은 별도다.

추가 점검 기록: 기존 일반 Skip Stop 버튼은 pickup/admin-assignment-error 분류로 고정되어 있다. 이는 기존 UI 의미를 바꾸는 별도 개선이며 이번 새 후보의 명시적 실패 응답과는 구분한다.

## 검증 경계와 활성화 전 체크

로컬 테스트의 GPS는 합성 자료다. South 실제 GPS를 재처리하거나 과거 배송 상태를 수정하지 않았다. 연결된 Android 기기가 없어 OS 종료·업데이트·오프라인·알림 표시·복귀 실주행은 미검증이다. 실제 서버의 24시간 worker·정정·알림 중복 제거는 서버 작업의 완료 조건이다. 임계값 승인, 서버 계약 배포 및 실기기 검증 후에만 운행별 정책을 활성화한다.

기존 릴리스 버전은 유지한다. 이 작업에서 APK/AAB 생성, 운영 배포 및 스토어 제출을 하지 않는다. service context에는 아직 존재하지 않는 서버 계약을 운영 정본으로 기록하지 않는다. 서버 계약 활성화 작업에서 `clever-context-monorepo`의 서비스 책임·후속 계정 인증·위치 추정 상태/정정 기준을 반영해야 한다.

## 로컬 검증 결과 (2026-09-21)

- `npm run check:workspace`: source-layout, TypeScript, 전체 784 tests 통과.
- `npm run lint`: 오류 0. baseline에도 있던 AppRoot `resetRouteProgress` hook dependency 경고 3개 유지.
- `npm run build`: Android/iOS JavaScript export 통과. native APK/AAB 또는 스토어 빌드 증거가 아니다.
- mock 환경의 Metro `/status`: `packager-status:running` 확인 후 이번 작업의 서버 종료.
- `git diff --check`: 통과.
- 별도 코드 리뷰에서 ACK/최신 응답 경합, 초기 저장·계정 전환, 종료 후 복귀 의사, 추정 표시 및 수동 실패·취소 우선순위를 보강하고 재검토했다.
- 연결된 실기기는 없고 로컬 Xcode license 미수락으로 simctl도 사용하지 않았다. 실제 화면 렌더·GPS/OS 알림·업데이트 보존 검증은 남아 있다. GitHub CI는 수동 실행 전용이며 이 로컬 검증과 구분한다.
