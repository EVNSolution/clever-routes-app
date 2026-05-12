# CLEVER PR review completion

- target repo: `EVNSolution/clever-driver-app`
- target service: `clever-driver-app`
- target branch: `dev` / `main`
- source branch:
- project-start issue:
- change-control issue:
- target repo issue:

## 변경 내용

-

## PR Scope Grouping Gate

- grouping decision: `single-pr` / `split-required`
- same document/operating-rule cleanup:
- same validation command:
- different app/service/contract surface:
- merge order dependency:
- rollback unit:

같은 issue 안의 같은 운영 문서/절차 정리이고 같은 검증으로 충분하면 `single-pr`로 둔다.
앱, 서비스, 계약 표면, merge 순서, 롤백 단위가 다르면 `split-required`로 둔다.

## 검증

-

## Concurrent Work Gate

- parallel work decision: `done` / `blocked` / `allowed-with-non-overlap` / `user-forced-proceed`
- target repo issue:
- clever-change-control issue:
- open PR checked:
- conflict candidates:
- user-forced-proceed reason:

## PR 검토 에이전트 종료 조건

- 검토 에이전트 작업은 wiki/service context 업데이트로 마친다.
- PR 정보를 wiki에 올리지 않는다.
- wiki에는 필요한 서비스 책임, public contract, deploy/runtime 기준, 운영 caveat, 빠른 탐색 요약만 반영한다.

## Context/wiki completion

- repo docs checked:
  - `.gitignore`
  - `.dockerignore`
  - `.editorconfig` / `.gitattributes`
  - `.env.example`
  - `app.json` / `eas.json`
  - `README.md`
  - `docs/project-brief.md`
  - `docs/repository-setup.md`
  - `docs/route-access-flow.md`
  - `docs/release-readiness.md`
  - `CONTRIBUTING.md` / `SECURITY.md`
- context docs checked:
  - `clever-context-monorepo/docs/services/<service>/index.md`
  - `clever-context-monorepo/docs/wiki/`
  - related `clever-context-monorepo/docs/root/` or `contracts/`
- wiki/service context update result: `updated` / `not-needed`
- service doc update:
- wiki update:
- clever-context-monorepo update:
- not-needed reason:

## Linked issue close evidence

- linked issue close evidence:
- 이슈 종료는 PR 검토 완료 결과를 근거로 처리한다.
- 이슈 종료 코멘트에는 wiki/service context 반영 결과 또는 불필요 사유를 이 PR에서 복사해 남긴다.

## PR 기준

- `dev` PR과 `main` PR은 검토 에이전트 종료 조건을 채운다.
- `main` PR은 deploy merge 단위로 보고 wiki/service context 업데이트 여부를 다시 확인한다.
- `dev` PR은 integration merge 단위로 보고 issue close 전에 wiki/service context 업데이트 여부를 확인한다.
