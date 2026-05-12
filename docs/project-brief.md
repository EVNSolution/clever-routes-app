# Project Brief

## 이 파일의 역할

이 파일은 `clever-driver-app`의 초기 기획 초안이다.

agent 작업 절차, branch 운영, 테스트 순서, 완료 조건은 `AGENTS.md`에 둔다.
이 문서는 무엇을 만들지, 왜 필요한지, 현재 어디까지 확정됐는지를 기록한다.

## 연결값

- project-start issue: `EVNSolution/clever-change-control#145`
- target repo issue: `EVNSolution/clever-driver-app#1`
- target repo: `EVNSolution/clever-driver-app`
- target service: `clever-driver-app`
- template lineage: `clever-agent-project/docs/templates@main`

## 레포 역할

`clever-driver-app`는 Clever/Tomatono 배송원이 쓰는 driver-facing mobile client의 구현 대상 repo다.

이 repo가 책임지는 것:

- 배송원 모바일 UX와 앱 런타임 코드
- 전화번호 기반 접근 시작 화면과 초대/접근 상태 표시
- 위치정보 처리 동의 및 개인정보 이용 동의 UX
- 배송원에게 배정된 당일 route/stop 조회 화면
- 모바일 앱의 로컬 검증, 빌드, smoke evidence

이 repo가 책임지지 않는 것:

- driver, route, order의 canonical data model
- 관리자용 driver 등록/초대, route 생성/편집/삭제 UX
- server-side compliance record 저장소와 API contract의 최종 정본
- Shopify embedded admin console 구현

정본 경계:

- `clever-delivery-server`: driver/route/order/compliance record의 server-side source of truth
- `clever-context-monorepo`: 서비스 책임, API, 데이터 흐름, 배포 context의 해석 정본
- `clever-change-control`: project-start/change-control 승인과 추적 정본
- 이 repo: 배송원 모바일 client 구현과 로컬 앱 문맥

## 문제 정의

Clever/Tomatono 배송 운영에는 관리자 콘솔과 delivery server는 준비되고 있으나, 실제 배송원이 당일 배정 route를 확인하고 위치정보 처리 동의를 완료할 수 있는 전용 모바일 앱 repo가 없다.

## 기대 결과

배송원이 전화번호 기반으로 접근하고, 위치정보 및 개인정보 이용 동의를 완료한 뒤, 당일 자신에게 배정된 route를 확인해 배송을 준비할 수 있는 1차 MVP 앱을 만든다.

## 플랫폼 전략

1차 플랫폼 기준은 iPhone과 Android phone에서 동작하는 native mobile app이다.

판단 이유:

- 배송원 앱은 위치 권한, 위치 처리 동의 기록, 개인정보 이용 기록, 접근 로그, 보안 상태 처리가 필요하다.
- MVP 이후 foreground/background location service, push notification, device permission state, 불안정한 네트워크 대응이 중요해질 가능성이 높다.
- PWA/web app은 접근성은 좋지만 background/foreground service, 위치 권한 UX, store/MDM 기반 배포 통제, 기기별 권한 동작의 예측 가능성이 native app보다 약하다.

기본 방향:

- implementation target: iOS + Android cross-platform native app
- preferred framework candidate: Expo/React Native 계열 우선 검토
- distribution candidates:
  - App Store/TestFlight and Google Play testing/production tracks
  - driver 대상이 제한된 경우 Apple Business Manager Custom Apps and managed Google Play/private app
- PWA/web app: 공식 앱 설치 전 임시 접근, 운영 fallback, 또는 admin/support 보조 화면으로만 검토한다. driver MVP의 본선 플랫폼으로 두지 않는다.

MVP와 확장 경계:

- route 조회 MVP는 전화번호 접근, 동의 기록, 당일 assigned route 확인까지를 최소 기능으로 둔다.
- foreground/background location service는 앱 플랫폼 선택의 핵심 요구사항이지만, 실제 위치 이벤트 송신은 별도 구현 이슈에서 `delivery_active` slice로 분리할 수 있다.
- 후속 이슈가 scope를 확장하지 않는 한 framework bootstrap PR은 background location을 실제 수집하지 않고 권한/설정 위치와 테스트 가능성만 준비한다.

플랫폼 결정 완료 기준:

- iOS/Android foreground location 권한 요청과 consent UX를 구현할 수 있다.
- background location 또는 background task가 필요한 후속 단계에서 store review/privacy disclosure 리스크를 추적할 수 있다.
- App Store/Play Store 공개 배포와 private/internal 배포 중 운영 정책에 맞는 경로를 선택할 수 있다.
- local build, test, smoke evidence를 PR 검증에 포함할 수 있다.

## 제약

- 서버가 route/order/driver canonical source of truth다.
- 모바일 앱은 배송원용 UX에 집중하고 관리자 기능을 포함하지 않는다.
- 위치정보 동의, 개인정보 이용 동의, 접근 로그/이용 기록 요구사항은 delivery server의 compliance 계획과 호응해야 한다.
- 구현 작업은 target issue와 linked branch를 통해 진행한다.
- 본 bootstrap 범위는 repo 준비와 플랫폼 방향 고정까지이며 앱 프레임워크/인증 상세 구현은 후속 이슈에서 결정한다.

## 초기 범위

### 포함

- 배송원 전화번호 입력 기반 접근 시작 UX
- 위치정보 처리 동의 및 개인정보 이용 동의 UX/기록 연동
- 당일 배정 route 조회와 배송 준비 화면

### 제외

- 관리자용 driver 등록/초대 화면
- route 생성/편집/삭제 기능
- 정산, 고객 알림, 실시간 관제 고도화

## 사용자와 운영 맥락

- primary user: 배송원/드라이버
- operator or admin: Shopify embedded admin console을 쓰는 Tomatono/Clever 운영자
- runtime environment: iOS/Android mobile app runtime, delivery server API, Shopify-backed admin context
- deploy target: pending; likely App Store/TestFlight + Google Play tracks, or private/internal distribution through Apple Business Manager and managed Google Play after 운영 정책 확정

## 기능 초안

1. 전화번호 입력 및 서버 driver invite 상태 확인
2. 위치정보/개인정보 동의 수집 및 서버 기록 연동
3. 당일 assigned route/stop list 조회
4. stop detail에서 주소, 순서, 지도 이동 준비 정보 확인
5. MVP 이후 위치 업데이트 송신과 delivery status update 확장

## 핵심 사용자 시나리오

### 시나리오 1: 앱 첫 실행과 전화번호 접근

- 배송원이 iPhone 또는 Android phone에서 앱을 실행한다.
- 앱은 관리자 기능 없이 배송원용 시작 화면을 보여준다.
- 배송원은 전화번호를 입력한다.
- 앱은 서버에 phone lookup을 요청해 초대된 배송원인지 확인한다.
- 초대된 배송원이면 동의 단계로 이동한다.
- 초대되지 않은 번호, 비활성 driver, 차단된 driver는 route 데이터를 받지 못하고 안내 화면에 머문다.
- MVP 문서 기준 첫 관문은 `전화번호 + 초대 상태 확인`으로 둔다.
- phone lookup만으로 production route/stop 데이터를 노출하지 않는다. 서버는 후속 driver API contract에서 driver-scoped short-lived session/access token 또는 동등한 접근 경계를 정의해야 한다.
- OTP, deep link invite token, managed identity 같은 강한 인증은 driver API contract 후속 이슈에서 결정한다.

### 시나리오 2: 동의 gate

- 앱은 route 조회 전에 위치정보 처리 동의와 개인정보 이용 동의를 요구한다.
- 동의 문구와 consent version은 서버 또는 legal copy source와 맞춘다.
- 동의 제출은 서버 consent record API에 기록되어야 한다.
- 동의 성공 전에는 assigned route 화면으로 이동하지 않는다.
- 법적/서비스 동의와 OS 위치 권한 요청은 분리한다. OS foreground/background 위치 권한은 기본적으로 배송 시작 액션 이후 요청한다.

### 시나리오 3: 당일 assigned route 확인

- 동의가 완료된 배송원은 당일 자신에게 배정된 route를 조회한다.
- `당일` 기준은 기기 local date가 아니라 서버가 관리하는 shop/route timezone의 `deliveryDate`로 둔다.
- 앱은 route summary, stop list, stop detail을 배송원에게 보여준다.
- stop detail은 주소, 순서, 배송 준비에 필요한 지도 이동 정보를 포함한다.
- route/stop 조회는 서버의 tenant boundary와 assigned driver 또는 active session boundary를 통과해야 한다.
- 서버 compliance 기준상 driver assigned route read와 stop detail read는 위치정보가 driver app으로 반환되는 `PROVIDE` 성격의 동작으로 본다.

### 시나리오 4: 배송 시작과 위치 서비스

- 배송원은 route를 확인한 뒤 명시적으로 `배송 시작`을 누른다.
- 앱은 이 시점부터 foreground location 권한을 요청하고, 필요한 경우 background location 권한을 단계적으로 요청한다.
- 위치 수집과 위치 이벤트 송신은 `배송 시작` 이후에만 허용한다.
- 위치 이벤트는 서버 driver event/location update API로 전송한다.
- 서버 compliance 기준상 driver GPS update는 위치정보 `COLLECT` 성격의 동작으로 본다.
- 배송 시작 전에는 background location 수집을 하지 않는다.

### 시나리오 5: 배송 종료와 기록 정리

- 배송원이 `배송 종료` 또는 route 완료 상태에 도달하면 앱은 위치 이벤트 송신을 중단한다.
- 앱은 마지막 sync 상태를 표시하고, 전송 실패 이벤트가 있으면 재시도 또는 미전송 안내를 제공한다.
- 이후 앱 재실행 시에는 당일 route 상태와 driver session/access 상태를 서버에서 다시 확인한다.

## 상태 흐름

문서 기준 상태 흐름은 아래 순서로 둔다.

```text
unidentified
  -> invited
  -> consent_required
  -> consent_recorded
  -> route_ready
  -> delivery_active
  -> delivery_finished
```

- `unidentified`: 앱 첫 실행 또는 session 없음. 전화번호 입력 전 상태.
- `invited`: 서버가 초대된 배송원으로 확인했지만 필수 동의가 끝나지 않은 상태.
- `consent_required`: 위치정보/개인정보 동의가 필요하거나 consent version이 갱신된 상태.
- `consent_recorded`: 서버가 필수 동의를 기록했고 route 조회가 가능한 상태.
- `route_ready`: 당일 assigned route를 확인할 수 있으나 아직 위치 수집은 시작하지 않은 상태.
- `delivery_active`: 배송원이 `배송 시작`을 눌렀고 위치 권한/서비스가 활성화되는 상태.
- `delivery_finished`: 배송이 종료되어 위치 이벤트 송신을 중단한 상태.

불변 조건:

- 동의 기록 전에는 assigned route를 표시하지 않는다.
- `delivery_active` 전에는 driver GPS location event를 서버에 보내지 않는다.
- 위치 권한 거부 또는 철회 상태에서는 `delivery_active`로 진입하지 않고 복구 안내를 보여준다.
- route/stop data는 서버가 확인한 assigned driver boundary 밖으로 노출하지 않는다.

## 실패/예외 시나리오

- 초대되지 않은 전화번호: 가입/관리자 문의 안내를 보여주고 route/consent API로 진행하지 않는다.
- 비활성 또는 차단된 driver: 접근 불가 안내를 보여주고 session을 만들지 않는다.
- service/legal consent 철회 또는 consent version 갱신: `consent_required`로 되돌리고 route 화면 진입을 막는다.
- consent submit 실패: route 화면으로 이동하지 않고 재시도와 지원 문의 안내를 제공한다.
- OS 위치 권한 거부: route 확인은 유지하되 배송 시작은 막고 설정 이동/재시도 안내를 제공한다.
- OS 위치 권한 철회: active delivery 중이면 위치 송신을 중단하고 서버에 가능한 상태 이벤트를 보낸 뒤 복구 안내를 제공한다.
- 당일 route 없음: "오늘 배정된 route 없음" 상태를 표시하고 자동으로 다른 driver/route를 노출하지 않는다.
- 서버/API 장애: 현재 화면의 민감 데이터 확대 표시를 피하고 재시도 가능한 오류 상태로 둔다.
- 네트워크 불안정: 위치 이벤트는 안전한 범위에서 재시도 대상으로 관리하되, 중복 전송과 민감 payload logging을 피한다. 후속 구현은 idempotency key, local queue 보존 범위, 실패 폐기 기준을 정해야 한다.

## Server contract 필요 항목

후속 server/API 이슈에서 아래 driver-facing contract를 정의해야 한다.

- phone lookup: 전화번호를 기준으로 invited/not-found/disabled/blocked 상태를 구분한다.
- driver session/access boundary: phone lookup 성공 후 route/stop read에 사용할 driver-scoped session/access token 또는 동등한 서버 검증 경계를 정의한다.
- consent record: consent type, consent version, driver identity, timestamp, device/app context를 서버에 기록한다.
- assigned route read: shop/shopDomain tenant boundary와 assigned driver boundary 안에서만 shop/route timezone 기준 당일 route summary와 stop list를 반환한다.
- stop detail read: 배송 준비에 필요한 주소/순서/지도 이동 정보를 반환하되 다른 driver route 접근은 차단한다.
- driver event/location update: `배송 시작` 이후 foreground/background 위치 이벤트와 delivery status event를 수집한다.
- access/usage logging: route/stop read는 위치정보 `PROVIDE`, GPS update는 위치정보 `COLLECT`로 분류할 수 있도록 서버 compliance log와 맞춘다.

## 구현 계획 v0

이 계획은 코드 구현 전에 repo 역할과 순서를 고정하기 위한 초안이다. 각 단계는 별도 target issue와 GitHub Development linked branch에서 진행한다.

### 0단계: repo context 고정

- 목적: 이 repo의 역할, MVP 경계, 후속 구현 순서를 명확히 한다.
- 산출물: `docs/project-brief.md`, `README.md`, issue/branch/PR 운영 기준 확인
- 완료 기준:
  - 레포 역할과 non-goal이 문서에 명시된다.
  - 구현은 후속 issue-linked branch에서만 진행한다는 제약이 남아 있다.
  - open PR/active branch 충돌이 없거나 non-overlap 판정이 기록된다.
- 검증:
  - `git diff --check`
  - 문서 diff review

### 1단계: mobile framework bootstrap

- 목적: 앱을 실행·검증할 수 있는 최소 mobile runtime을 만든다.
- 선행 결정:
  - framework: Expo/React Native 계열 우선 검토
  - package manager와 Node/runtime version
  - 앱 라우팅 방식과 기본 화면 구조
  - iOS/Android permission, privacy disclosure, background capability 설정 위치
- 산출물:
  - 앱 skeleton
  - lint/typecheck/test/build 또는 start command
  - base navigation과 placeholder screens
- 완료 기준:
  - clean checkout에서 install 후 앱 시작 command가 동작한다.
  - PR 전 필수 검증 명령이 repo 현실에 맞게 정의된다.

### 2단계: driver access 시작 UX

- 목적: 배송원이 전화번호를 입력하고 서버에서 driver invite/access 상태를 확인하는 시작 흐름을 만든다.
- 선행 계약:
  - E.164 phone normalization 기준
  - delivery server의 driver-facing phone lookup endpoint
  - invited/not-found/disabled/blocked/error 상태 코드
- 산출물:
  - phone input screen
  - validation and API error state rendering
  - session/access state 저장 방식
- 완료 기준:
  - 유효하지 않은 번호는 서버 요청 전에 막는다.
  - 초대된 배송원만 consent 단계로 이동한다.

### 3단계: consent gate

- 목적: 위치정보 처리 동의와 개인정보 이용 동의를 route 조회 전 필수 gate로 만든다.
- 선행 계약:
  - legal copy source
  - consent versioning
  - delivery server consent record endpoint
  - foreground/background location 권한 요청 시점과 거절/재요청 UX
- 산출물:
  - consent screen
  - required consent state machine
  - consent submit/retry/error UX
- 완료 기준:
  - 동의 전에는 route 화면에 접근할 수 없다.
  - 동의 성공 후 서버 기록 결과를 근거로 다음 화면으로 이동한다.

### 4단계: assigned route MVP

- 목적: 배송원이 당일 자신에게 배정된 route와 stop list를 확인한다.
- 선행 계약:
  - assigned route 조회 endpoint
  - route/stop response shape
  - no-route, multiple-route, API error 상태 처리 기준
- 산출물:
  - today's route screen
  - stop list and stop detail screen
  - 주소/순서/지도 이동 준비 정보 표시
- 완료 기준:
  - invited phone → consent accepted → today's route 확인 smoke flow가 가능하다.
  - route 없음/error 상태가 사용자에게 명확히 표시된다.

### 5단계: release evidence and context sync

- 목적: MVP 앱을 검증 가능한 형태로 묶고 서비스 context 정본 반영 필요 여부를 처리한다.
- 산출물:
  - local or CI verification output
  - mobile runtime screenshot/video 또는 build artifact
  - 필요 시 `clever-context-monorepo/docs/services/clever-driver-app/index.md`
- 완료 기준:
  - PR 본문에 target issue, change-control issue, linked branch, 검증 결과가 남는다.
  - public contract/API/data flow 변경 여부가 context monorepo에 반영되거나 불필요 사유가 기록된다.

## 작업 분리 원칙

- mobile framework bootstrap과 driver-facing API contract 정의는 분리한다.
- server API shape가 확정되지 않은 상태에서는 앱 UI를 mock boundary까지 구현하고, 실제 contract 연동 PR은 별도 issue로 둔다.
- consent legal copy/source와 consent record API는 route 화면 구현보다 먼저 결정한다.
- public API, env, deploy profile이 바뀌면 context monorepo 반영 여부를 PR에서 판단한다.

## 데이터와 연동

- input data: E.164 phone, consent decisions, current date/device context
- output data: consent record, driver session/access state, optional location update after MVP expansion
- external systems: `clever-delivery-server`, Tomatono Shopify order context, mobile map/provider stack
- public contract: delivery server driver-facing API contract to be defined in follow-up issue

## 검증 초안

- local verification: lint, typecheck, unit tests, app start/build command after framework bootstrap
- automated tests: phone input validation, consent gate, assigned route rendering, API error states
- smoke test: open app, enter invited phone, accept consents, see today's route
- release evidence: linked PR, CI output, mobile build artifact or local runtime screenshot/video

## 미정 사항

- mobile framework and package manager
- driver authentication/session method after phone lookup
- consent record API shape and legal copy source
- map provider and background location policy for post-MVP
- minimum supported iOS/Android versions and physical-device background-location smoke matrix
- local queue/idempotency policy for failed driver location events

## 다음 작업 목록

1. Create implementation issue for mobile framework bootstrap and base navigation.
2. Define driver-facing delivery server API contract for phone access, consent, and assigned route.
3. Add context-monorepo service document once framework/API boundaries are confirmed.
