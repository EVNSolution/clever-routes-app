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

## 문제 정의

Clever/Tomatono 배송 운영에는 관리자 콘솔과 delivery server는 준비되고 있으나, 실제 배송원이 당일 배정 route를 확인하고 위치정보 처리 동의를 완료할 수 있는 전용 모바일 앱 repo가 없다.

## 기대 결과

배송원이 전화번호 기반으로 접근하고, 위치정보 및 개인정보 이용 동의를 완료한 뒤, 당일 자신에게 배정된 route를 확인해 배송을 준비할 수 있는 1차 MVP 앱을 만든다.

## 제약

- 서버가 route/order/driver canonical source of truth다.
- 모바일 앱은 배송원용 UX에 집중하고 관리자 기능을 포함하지 않는다.
- 위치정보 동의, 개인정보 이용 동의, 접근 로그/이용 기록 요구사항은 delivery server의 compliance 계획과 호응해야 한다.
- 구현 작업은 target issue와 linked branch를 통해 진행한다.
- 본 bootstrap 범위는 repo 준비까지이며 앱 프레임워크/인증 상세 구현은 후속 이슈에서 결정한다.

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
- runtime environment: mobile app runtime, delivery server API, Shopify-backed admin context
- deploy target: pending; likely Expo/EAS or native mobile distribution after framework decision

## 기능 초안

1. 전화번호 입력 및 서버 driver invite 상태 확인
2. 위치정보/개인정보 동의 수집 및 서버 기록 연동
3. 당일 assigned route/stop list 조회
4. stop detail에서 주소, 순서, 지도 이동 준비 정보 확인
5. MVP 이후 위치 업데이트 송신과 delivery status update 확장

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

## 다음 작업 목록

1. Create implementation issue for mobile framework bootstrap and base navigation.
2. Define driver-facing delivery server API contract for phone access, consent, and assigned route.
3. Add context-monorepo service document once framework/API boundaries are confirmed.
