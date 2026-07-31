# Project Brief

## 이 파일의 역할

이 파일은 `clever-routes-app`의 초기 기획 초안이다.

agent 작업 절차, branch 운영, 테스트 순서, 완료 조건은 `AGENTS.md`에 둔다.
이 문서는 무엇을 만들지, 왜 필요한지, 현재 어디까지 확정됐는지를 기록한다.

## 연결값

- project-start issue: `EVNSolution/clever-change-control#145`
- target repo issue: `EVNSolution/clever-routes-app#1`
- target repo: `EVNSolution/clever-routes-app`
- target service: `clever-routes-app`
- template lineage: `clever-agent-project/docs/templates@main`

## 레포 역할

`clever-routes-app`는 Clever/Tomatono 배송원이 쓰는 driver-facing mobile client의 구현 대상 repo다.

이 repo가 책임지는 것:

- 배송원 모바일 UX와 앱 런타임 코드
- 전화번호 + 6자리 PIN 기반 계정 로그인, 최초 초대 등록, 회사 안내
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

배송원이 전화번호 + 6자리 PIN으로 로그인하고, 자신이 수행할 회사/shop/route 안내를 확인하고, 위치정보 및 개인정보 이용 동의를 완료한 뒤, 당일 자신에게 배정된 route를 확인해 배송을 준비할 수 있는 1차 MVP 앱을 만든다.

## 플랫폼 전략

1차 플랫폼 기준은 iPhone과 Android phone에서 동작하는 native mobile app이다.

판단 이유:

- 배송원 앱은 위치 권한, 위치 처리 동의 기록, 개인정보 이용 기록, 접근 로그, 보안 상태 처리가 필요하다.
- MVP 이후 foreground/background location service, push notification, device permission state, 불안정한 네트워크 대응이 중요해질 가능성이 높다.
- PWA/web app은 접근성은 좋지만 background/foreground service, 위치 권한 UX, store/MDM 기반 배포 통제, 기기별 권한 동작의 예측 가능성이 native app보다 약하다.

기본 방향:

- implementation target: iOS + Android cross-platform native app
- selected framework: Expo/React Native 계열로 1차 구현 진행
- distribution candidates:
  - App Store/TestFlight and Google Play testing/production tracks
  - driver 대상이 제한된 경우 Apple Business Manager Custom Apps and managed Google Play/private app
- PWA/web app: 공식 앱 설치 전 임시 접근, 운영 fallback, 또는 admin/support 보조 화면으로만 검토한다. driver MVP의 본선 플랫폼으로 두지 않는다.

MVP와 확장 경계:

- route 조회 MVP는 전화번호 + PIN 계정 접근, 동의 기록, 당일 assigned route 확인까지를 최소 기능으로 둔다.
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
- 다중회사/다중 shop 구조를 전제로 하되, 정규화된 E.164 전화번호 하나를 서버 소유의 전역 driver account identity로 사용한다.
- 위치정보 동의, 개인정보 이용 동의, 접근 로그/이용 기록 요구사항은 delivery server의 compliance 계획과 호응해야 한다.
- 구현 작업은 target issue와 linked branch를 통해 진행한다.
- 본 bootstrap 범위는 repo 준비와 플랫폼 방향 고정까지이며 앱 프레임워크/인증 상세 구현은 후속 이슈에서 결정한다.

## 초기 범위

### 포함

- 배송원 전화번호 + 6자리 PIN 로그인 및 최초 초대 등록 UX
- 배송원이 자신이 수행할 회사/shop/route 안내를 확인하는 UX
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

1. 국가번호 + 전화번호 입력 후 기존 계정은 6자리 PIN 로그인, 최초 계정은 기존 Shopify 초대코드 + 6자리 PIN 설정
2. 배정된 라우트 리스트 표시; 각 라우트에 회사/shop 안내를 귀속해서 표시
3. 위치정보/개인정보 동의 수집 및 서버 기록 연동
4. 당일 assigned route/stop list 조회
5. stop detail에서 주소, 순서, 지도 이동 준비 정보 확인
6. MVP 이후 위치 업데이트 송신과 delivery status update 확장

## 다중회사/tenant 시나리오

`회사`는 배송원이 인지하는 운영 주체이고, 서버 데이터 경계에서는 Shopify `Shop` 또는 tenant에 해당한다.

- 같은 전역 전화번호 계정에 여러 회사/shop의 driver invite 또는 route assignment가 연결될 수 있다.
- 기본 접근 단위는 서버가 관리하는 E.164 전화번호 계정이며 PIN은 이 전화번호 전체에 귀속된다.
- 계정 인증에 성공하면 서버는 해당 전화번호에 연결된 활성 라우트 선택지를 반환한다. 활성 라우트가 없으면 빈 라우트 리스트를 반환한다.
- 배송원 입장에서는 다중회사도 “여러 라우트”일 뿐이며, 회사/shop 정보는 각 라우트 정보에 귀속된다.
- 회사 안내에는 회사/shop 표시명, route 이름 또는 배송일, shop/route timezone 기준 `deliveryDate`, 출발/픽업/집결 안내, 운영자 연락처, 회사별 배송 유의사항, consent/legal copy source가 포함될 수 있다.
- 전화번호 + PIN 계정 인증 전에는 route/stop/customer data를 노출하지 않는다.
- 서버가 반환한 route choice 전에는 다른 회사의 route/stop/customer data를 보여주지 않는다.

## 핵심 사용자 시나리오

### 시나리오 1: 앱 첫 실행과 전화번호/PIN 접근

- 배송원이 iPhone 또는 Android phone에서 앱을 실행한다.
- 앱은 관리자 기능 없이 배송원용 시작 화면을 보여준다.
- 배송원은 지원 국가를 선택하고, 앱은 국가명/ISO/국가번호와 언어/locale/culture metadata를 표시하며, 해당 국가의 national phone format으로 전화번호를 입력한다.
- 앱은 전화번호를 E.164로 정규화한 뒤 두 번째 화면에서 6자리 숫자 PIN을 입력받는다.
- 기존 계정은 `전화번호 + PIN`으로 로그인하며 초대코드를 다시 요구하지 않는다.
- 최초 계정 등록 모드에서만 이미 Shopify 관리자가 발급한 6자리 초대코드와 새 PIN/확인 PIN을 받는다.
- 앱과 delivery server는 로그인 또는 등록 시 Shopify 초대 생성 요청을 자동으로 만들지 않는다. Shopify에서의 배송원 초대/가입 요청은 store 관리자가 별도로 직접 수행한다.
- 계정 로그인/등록 성공 후 account bearer로 route lookup을 요청해 해당 전화번호에 활성 라우트가 배정되어 있는지 확인한다.
- 배정된 활성 라우트가 있으면 앱은 route list를 보여주며, 각 route card에 회사 안내를 함께 표시한다.
- 초대되지 않은 번호, 비활성 driver, 차단된 driver는 route 데이터를 받지 못하고 안내 화면에 머문다.
- 첫 관문은 `전화번호 + 6자리 PIN 계정 인증`으로 둔다.
- 서버는 로그인/등록 성공 시 전역 `driver_account` access/refresh token을 내려주고, account bearer route lookup 성공 시 라우트별 short-lived `consent_and_assigned_route` token을 내려준다.
- 앱은 account token과 route token을 secure storage에서 분리하고, account refresh 후 route lookup을 다시 수행해 만료된 route token을 교체한다.
- 서버에서 배정이 삭제되거나 route lookup이 빈 결과/`NOT_FOUND`를 반환하면 account login은 유지하되 route token, route context, active route session, 화면 route list를 제거한다. 네트워크 오류만으로는 기존 route cache를 삭제하지 않는다.
- SMS OTP는 장기적으로 정상 회원가입 경로가 될 수 있지만 이번 버전에는 포함하지 않는다.
- 이 인증 구조 배포 전에 기존 배송원 레코드는 운영 DB에서 삭제했으며, 구 앱 secure-storage schema는 마이그레이션하지 않고 재로그인시킨다.

### 시나리오 1-a: 회사 안내 확인

- 앱은 계정 인증과 route lookup 성공 후 배송원이 어느 회사/shop의 어떤 배송 흐름에 들어왔는지 명확히 표시한다.
- 최소 안내 정보는 company/shop 표시명, deliveryDate, route 이름 또는 route summary, 출발/픽업/집결 안내, 운영자 연락처다.
- 회사별 배송 유의사항이나 consent/legal copy source가 있으면 동의 gate 이전 또는 동의 화면에서 함께 보여준다.
- 배송원이 회사/route가 본인 업무와 다르다고 판단하면 route 화면으로 진행하지 않고 종료 또는 지원 문의로 이동할 수 있어야 한다.

### 시나리오 2: 동의 gate

- 앱은 route 조회 전에 위치정보 처리 동의와 개인정보 이용 동의를 요구한다.
- 동의 문구와 consent version은 서버 또는 legal copy source와 맞춘다.
- 동의 제출은 서버 consent record API에 기록되어야 한다.
- 동의 성공 전에는 assigned route 화면으로 이동하지 않는다.
- 법적/서비스 동의와 OS 위치 권한 요청은 분리한다. OS foreground/background 위치 권한은 기본적으로 배송 시작 액션 이후 요청한다.

### 시나리오 3: 당일 assigned route 확인

- 동의가 완료된 배송원은 당일 자신에게 배정된 route를 조회한다.
- `당일` 기준은 기기 local date가 아니라 서버가 관리하는 shop/route timezone의 `deliveryDate`로 둔다.
- 앱은 route summary, stop list, stop detail과 OS map handoff를 배송원에게 보여준다.
- stop detail은 주소, 순서, 배송 준비에 필요한 지도 이동 정보를 포함하며 좌표 우선/주소 fallback 방식으로 OS map 앱을 연다.
- route/stop 조회는 서버의 tenant boundary와 assigned driver 또는 active session boundary를 통과해야 한다.
- 서버 compliance 기준상 driver assigned route read와 stop detail read는 위치정보가 driver app으로 반환되는 `PROVIDE` 성격의 동작으로 본다.

### 시나리오 4: 배송 시작과 위치 서비스

- 배송원은 route를 확인한 뒤 명시적으로 `배송 시작`을 누른다.
- 앱은 이 시점부터 foreground location 권한을 요청한다. background location 권한은 foreground 권한과 active delivery UX가 검증된 뒤 단계적으로 요청한다.
- 위치 수집과 위치 이벤트 송신은 `배송 시작` 이후에만 허용한다.
- 배송 시작 이벤트는 서버 driver event API에 `ROUTE_STARTED`로 기록한다. foreground one-shot GPS 위치 업데이트와 continuous/background-capable GPS update는 `LOCATION_UPDATED`로 전송할 수 있다.
- `delivery_active` 이후 continuous tracking action은 background location permission과 native task availability를 확인한 뒤 named task를 시작하고, task batch를 서버 driver event API의 `LOCATION_UPDATED`로 기록한다.
- `delivery_active` 이후 stop card에서 배송 완료/실패를 누르면 앱은 서버 driver event API에 `STOP_DELIVERED` 또는 `STOP_FAILED`를 기록한다. 현재 proof는 note, failure reason, Expo ImagePicker 기반 photo capture, proof media upload reference, scanner-rejected photo recapture guidance, signature drawing evidence와 app-side offline queue/retry를 포함한다. Delivery server에는 proof-media scan rejection hook이 있으며, production object storage/signed access/deployed scanner evidence는 후속 slice에서 다룬다.
- 서버 compliance 기준상 driver GPS `LOCATION_UPDATED`는 위치정보 `COLLECT` 성격의 동작으로 본다.
- 배송 시작 전에는 background location 수집을 하지 않는다.

### 시나리오 5: 배송 종료와 기록 정리

- 배송원이 `배송 종료` 또는 route 완료 상태에 도달하면 앱은 위치 이벤트 송신을 중단한다.
- 현재 앱은 delivery_active 이후 `Finish delivery` 동작에서 continuous location task를 중단하고 `ROUTE_COMPLETED` 이벤트를 기록한다.
- `ROUTE_COMPLETED` 기록이 실패하면 route completion event를 offline queue에 남기고, 기록 성공 시에만 해당 route의 local retry item을 cleanup한다.
- 앱은 마지막 sync 상태를 표시하고, 전송 실패 이벤트가 있으면 재시도 또는 미전송 안내를 제공한다.
- 이후 앱 재실행 시에는 당일 route 상태와 driver session/access 상태를 서버에서 다시 확인한다.

## 상태 흐름

문서 기준 상태 흐름은 아래 순서로 둔다.

```text
unidentified
  -> phone_entered
  -> account_authenticated
  -> company_context_confirmed
  -> consent_required
  -> consent_recorded
  -> route_ready
  -> delivery_active
  -> delivery_finished
```

- `unidentified`: 앱 첫 실행 또는 session 없음. 전화번호 입력 전 상태.
- `phone_entered`: E.164 배송원 전화번호가 입력된 상태.
- `account_authenticated`: 기존 계정 PIN 로그인 또는 최초 초대 등록을 마쳐 `driver_account` session이 발급된 상태.
- `company_context_confirmed`: account-authenticated route lookup이 하나 이상의 회사/shop route assignment와 매칭되어 라우트별 회사 안내를 표시할 수 있는 상태.
- `consent_required`: 위치정보/개인정보 동의가 필요하거나 consent version이 갱신된 상태.
- `consent_recorded`: 서버가 필수 동의를 기록했고 route 조회가 가능한 상태.
- `route_ready`: 당일 assigned route를 확인할 수 있으나 아직 위치 수집은 시작하지 않은 상태.
- `delivery_active`: 배송원이 `배송 시작`을 눌렀고 위치 권한/서비스가 활성화되는 상태.
- `delivery_finished`: 배송이 종료되어 위치 이벤트 송신을 중단한 상태.

불변 조건:

- 동의 기록 전에는 assigned route를 표시하지 않는다.
- `delivery_active` 전에는 driver GPS location event를 서버에 보내지 않는다.
- 위치 권한 거부 또는 철회 상태에서는 `delivery_active`로 진입하지 않고 복구 안내를 보여준다.
- route/stop data는 서버가 확인한 tenant/company boundary와 assigned driver boundary 밖으로 노출하지 않는다.
- 회사 안내 전에는 고객 주소, stop detail, 다른 회사 route 정보를 노출하지 않는다.

## 실패/예외 시나리오

- 초대되지 않은 전화번호의 최초 등록: 가입/관리자 문의 안내를 보여주고 route/consent API로 진행하지 않는다. 앱은 Shopify 초대를 자동 요청하지 않는다.
- 전화번호 미등록 또는 PIN 불일치: 회사/route data를 노출하지 않고 로그인 오류를 표시한다. 등록된 계정이지만 활성 라우트가 없으면 빈 라우트 리스트를 보여준다.
- 같은 전화번호의 다중 회사/route 매칭: 서버가 허용한 route choices를 보여주며, 각 choice에 회사 안내와 route metadata를 귀속한다.
- 비활성 또는 차단된 driver: 접근 불가 안내를 보여주고 session을 만들지 않는다.
- service/legal consent 철회 또는 consent version 갱신: `consent_required`로 되돌리고 route 화면 진입을 막는다.
- consent submit 실패: route 화면으로 이동하지 않고 재시도와 지원 문의 안내를 제공한다.
- OS 위치 권한 거부: route 확인은 유지하되 배송 시작은 막고 설정 이동/재시도 안내를 제공한다.
- OS 위치 권한 철회: active delivery 중이면 위치 송신을 중단하고 서버에 가능한 상태 이벤트를 보낸 뒤 복구 안내를 제공한다.
- 당일 route 없음: "오늘 배정된 route 없음" 상태를 표시하고 자동으로 다른 driver/route를 노출하지 않는다.
- 서버/API 장애: 현재 화면의 민감 데이터 확대 표시를 피하고 재시도 가능한 오류 상태로 둔다.
- 네트워크 불안정: driver event와 proof media submission은 durable app-side offline queue/retry 대상으로 관리하되, 중복 전송과 민감 payload logging을 피한다. 앱 로컬 queue는 5회 실패, 72시간 경과, route completion cleanup, 또는 명시적 driver session reset/sign-out 시 discard할 수 있는 기준과 앱 UI action을 둔다.
- proof media scanner rejection: 서버가 `422 PROOF_MEDIA_REJECTED`를 반환하면 앱은 durable proof reference를 만들지 않고 해당 사진을 retry queue에 남기지 않는다. 배송원에게는 scanner 내부 사유를 노출하지 않고 다른 proof photo를 다시 촬영하라고 안내한다.
- live downstream route token 만료: account session을 refresh한 뒤 account bearer route lookup으로 새 route token을 받고 consent, assigned-route, driver-event, proof-media 요청을 한 번 재시도한다. account refresh까지 실패하면 계정 로그인을 지우고 전화번호 + PIN 로그인을 요구한다.

## Server contract 필요 항목

delivery server와 앱은 아래 driver-facing contract를 사용한다.

- driver account auth: E.164 전화번호 전역 계정에 6자리 PIN hash와 refresh session을 귀속하고, 기존 계정 login 및 최초 invite registration을 분리한다.
- account-authenticated route lookup: `driver_account` bearer의 전화번호를 기준으로 tenant/company, route assignment, not-found/disabled/blocked 상태를 구분하고 활성 배정 라우트 선택지를 반환한다. request body에 전화번호를 다시 받지 않는다.
- company guidance payload: company/shop display name, deliveryDate, timezone, route display name/summary, pickup/depot/dispatch guidance, operator support contact, company-specific driver instructions를 민감 data 없이 반환한다.
- driver session/access boundary: account access/refresh token과 route-scoped short-lived access token의 용도와 저장 경계를 분리한다.
- consent record: consent type, consent version, driver identity, timestamp, device/app context를 서버에 기록한다.
- assigned route read: shop/shopDomain tenant boundary와 assigned driver boundary 안에서만 shop/route timezone 기준 당일 route summary와 stop list를 반환한다.
- stop detail read: 배송 준비에 필요한 주소/순서/지도 이동 정보를 반환하되 다른 driver route 접근은 차단한다.
- driver event/location update: `배송 시작` 이후 foreground/background 위치 이벤트와 route/stop delivery status event를 수집한다.
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
- baseline 결정:
  - framework: Expo/React Native
  - package manager/runtime: npm `package-lock.json`, Node `>=20.19.4`
  - 앱 구조: `index.ts`가 `App.tsx`를 등록하고, MVP state/guard 로직은 `src/domain/driverFlow/driverFlow.ts`에서 순수 함수로 검증한다.
  - iOS/Android 설정 위치: `app.json`에 bundle/package id, scheme, 기본 native runtime 옵션을 둔다.
  - background location 또는 실제 위치 수집은 이 단계에서 구현하지 않는다.
- 산출물:
  - 앱 skeleton
  - `lint`, `typecheck`, `test`, `build`, `check:workspace`, `start`, `ios`, `android` command
  - route access, company guidance, consent gate, assigned route, delivery active placeholder screens
  - repo setup notes and ignore policy review
- 완료 기준:
  - clean checkout에서 `npm install` 후 앱 시작 command가 준비된다.
  - PR 전 필수 검증 명령이 repo 현실에 맞게 정의되고 통과한다.
  - account auth, account-authenticated route choices, consent gate, delivery active guard가 unit test로 고정된다.

### 2단계: phone/PIN account access and route/company guidance UX

- 목적: 배송원이 전화번호와 PIN으로 계정을 인증하고 서버에서 활성 route assignment와 driver access 상태를 확인하는 시작 흐름을 만든다.
- 선행 계약:
  - supported-country i18n metadata, country-aware national phone formatting, and E.164 normalization 기준
  - delivery server의 driver account login/register/refresh 및 account-authenticated route lookup endpoint
  - `ROUTES_FOUND` route choice payload shape
  - route-scoped driver access token payload shape
  - not-found/disabled/blocked/error 상태 코드
- 산출물:
  - country selector/search and phone input screen
  - route list with company guidance per route
  - validation and API error state rendering
  - session/access state 저장 방식
- 완료 기준:
  - 유효하지 않은 번호는 서버 요청 전에 막는다.
  - account auth와 route lookup 성공 시 서버가 허용한 route choices만 표시한다.
  - 매칭된 배송원은 라우트별 회사/shop/route 안내를 확인한 뒤 consent/route 단계로 이동한다.
  - 서버가 route-scoped access token을 준 라우트만 consent/assigned-route API로 진행한다.

### 3단계: consent gate

- 목적: 위치정보 처리 동의와 개인정보 이용 동의를 route 조회 전 필수 gate로 만든다.
- 선행 계약:
  - legal copy source
  - consent versioning
  - delivery server consent record endpoint: live mode uses route lookup이 반환한 route-scoped `driverAccess` token for consent submission
  - foreground/background location 권한 요청 시점과 거절/재요청 UX
- 산출물:
  - consent screen: implemented in local Expo flow
  - required consent state machine: `consent_required` → `consent_recorded` implemented for app-side boundary
  - consent submit/retry/error UX: implemented with local success/failure mock
- 완료 기준:
  - 동의 전에는 route 화면에 접근할 수 없다.
  - 동의 성공 후 서버 기록 결과를 근거로 `consent_recorded` 상태로 이동한다.
  - live server consent submission은 선택 라우트의 route-scoped driver access token으로 수행된다.

### 4단계: assigned route MVP

- 목적: 배송원이 현재/예정 route session과 stop list를 확인한다.
- 선행 계약:
  - assigned route 조회 endpoint: delivery-server `GET /driver/assigned-route` and app API boundary are implemented
  - route/stop response shape: route summary and ordered stop cards are implemented in the local Expo flow
  - no-route, multiple-route, API error 상태 처리 기준: no-route and API error states are implemented; multi-company/multiple-route assignments are now app-visible route choices with company guidance attached to each route
- 산출물:
  - current/upcoming routes screen: implemented after consent with local mock/API boundary
  - stop list and stop detail screen: implemented as ordered stop cards for route-ready MVP
  - 주소/순서/지도 이동 준비 정보 표시: address, sequence, phone, coordinate text, and OS map handoff are implemented; provider SDK selection remains a later product decision
- 완료 기준:
  - phone + PIN login 또는 invite registration → consent accepted → current/upcoming route 확인 smoke flow가 가능하다.
  - route 없음/error 상태가 사용자에게 명확히 표시된다.
  - live server calls는 secure storage의 account token과 route token을 분리하며, route token `401` 시 account refresh + route re-lookup으로 복구한다.

### 5단계: release evidence and context sync

- 목적: MVP 앱을 검증 가능한 형태로 묶고 서비스 context 정본 반영 필요 여부를 처리한다.
- 산출물:
  - local or CI verification output
  - mobile runtime screenshot/video 또는 build artifact
  - 필요 시 `clever-context-monorepo/docs/services/clever-routes-app/index.md`
- 완료 기준:
  - PR 본문에 target issue, change-control issue, linked branch, 검증 결과가 남는다.
  - public contract/API/data flow 변경 여부가 context monorepo에 반영되거나 불필요 사유가 기록된다.

## 작업 분리 원칙

- mobile framework bootstrap과 driver-facing API contract 정의는 분리한다.
- server API shape가 확정되지 않은 상태에서는 앱 UI를 mock boundary까지 구현하고, 실제 contract 연동 PR은 별도 issue로 둔다.
- consent legal copy/source와 consent record API는 route 화면 구현보다 먼저 결정한다.
- public API, env, deploy profile이 바뀌면 context monorepo 반영 여부를 PR에서 판단한다.

## 데이터와 연동

- input data: selected phone country, national phone input normalized to E.164, 6-digit PIN, first-registration invite code, consent decisions, current date/device context, server-issued route assignment identifiers
- output data: company guidance, consent record, assigned route/stop display state, driver session/access state, optional location update after MVP expansion
- external systems: `clever-delivery-server`, Tomatono Shopify order context, mobile map/provider stack
- public contract: delivery server driver account login/register/refresh, account-authenticated route access lookup, consent record, assigned route read, driver events, location updates, proof media, and route completion boundaries are implemented. Account and route tokens are persisted separately; authoritative empty/deleted assignment results clear only route cache, while expired account refresh requires phone + PIN login.

## 검증 초안

- local verification: lint, typecheck, unit tests, app start/build command after framework bootstrap
- automated tests: phone/PIN auth contract, first-registration invite contract, account-bearer route lookup, token separation/refresh, deleted assignment cache clearing, route choice parsing, consent gate, assigned route rendering, API error states
- smoke test: open app, enter phone + PIN or complete first registration, accept consents, see current/upcoming route choices, remove assignment server-side, refresh and confirm it disappears
- release evidence: linked PR, CI output, mobile build artifact or local runtime screenshot/video

## 미정 사항

- SMS OTP registration/recovery path and forgotten-PIN policy
- consent legal copy source and production version registry
- dedicated native map provider SDK choice and background location policy for post-MVP
- minimum supported iOS/Android versions and physical-device background-location smoke matrix
- production proof-media object storage/signed access/scanner backend policy and deployed cleanup release evidence

## 다음 작업 목록

1. Merge mobile framework bootstrap and base navigation PR into `dev`. — completed
2. Define driver-facing delivery server API contract for phone access and route/company guidance. — completed in `clever-delivery-server#48`
3. Implement phone access and route/company guidance UX against the agreed mock/API boundary. — completed
4. Implement consent record app UX/API boundary. — completed
5. Implement assigned route screen and app API boundary. — completed
6. Implement driver access token handoff. — completed
7. Implement real environment/base URL switch. — completed
8. Implement secure token persistence/expiry handling. — completed
9. Implement delivery-active foreground location permission slice. — completed
10. Implement route-started driver event after delivery_active. — completed
11. Implement foreground `LOCATION_UPDATED` event after delivery_active. — completed
12. Implement text-only stop delivered/failed proof events after delivery_active. — completed
13. Implement background location service and continuous GPS `LOCATION_UPDATED` streaming. — completed
14. Add richer proof-of-delivery metadata: note, photo URI metadata, failure reason taxonomy. — completed
15. Add native proof photo URI capture from camera/library. — completed
16. Add binary proof media upload/native capture: photo file upload and signature drawing. — completed as app-side boundary; barcode proof capture is not in the current app scope
17. Add offline queue/retry policy for driver events and proof media. — completed as durable app-side queue boundary
18. Add app-side offline queue retention/discard thresholds after repeated failure, route completion, or driver sign-out/session reset. — completed, including explicit app session reset cleanup action
19. Add release-readiness checklist for physical iOS/Android smoke matrix and production store/privacy disclosure evidence. — completed as documentation checklist; real device/store evidence remains pending
20. Add EAS preview/production native build-profile scaffolding for iOS/Android release evidence. — completed
21. Implement delivery finish with `ROUTE_COMPLETED`, tracking stop, and route-scoped local queue cleanup. — completed
22. Implement app-side live downstream `401` expired-token recovery and phone re-lookup guidance. — completed as app-side boundary; physical-device/live-server evidence remains pending
23. Implement app-side proof media scanner rejection handling. — completed as app-side boundary; live scanner/backend deployment evidence remains pending
24. Add local proof-media scanner rejection smoke mock mode. — completed as physical-device verification aid; real device evidence remains pending
25. Add physical iOS/Android smoke matrix and production store/privacy disclosure evidence for background tracking.
26. Add context-monorepo service document once production runtime/API boundaries are confirmed. — baseline pointer completed in `clever-context-monorepo#24`; future production boundary changes should open a new context issue only if durable service responsibility, public contract, deployment/runtime category, or cross-repo interpretation changes.
