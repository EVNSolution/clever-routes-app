# AGENTS.md

## 이 파일의 역할

이 파일은 프로젝트 기획서가 아니다.

이 파일은 이 target repo에서 agent가 작업을 수행할 때 따라야 하는 실행 절차서다.
기획, 제품 범위, 사용자 가치, 미정 요구사항은 `docs/project-brief.md`에 둔다.

## 프로젝트 연결값

- project-start issue: `EVNSolution/clever-change-control#145`
- change-control issue: `EVNSolution/clever-change-control#145`
- target repo: `EVNSolution/clever-routes-app`
- target service: `clever-routes-app`
- template lineage: `clever-agent-project/docs/templates@main`
- default work branch: `dev`

값이 아직 확정되지 않은 항목은 `pending`으로 남기고, 추측해서 채우지 않는다.

## Preflight Gate

새 target repo에서 팀 작업 자동화, issue/PR 동시작업 판정, ruleset 적용, CODEOWNERS/CI 보강 같은 team-work automation을 시작하기 전에는 control-plane preflight가 먼저 통과되어야 한다.

control-plane workspace의 `clever-agent-project`에서 실행한다. 첫 실행 때는 gh CLI에서 GitHub 계정을 먼저 확인하고, 확인되면 별도로 묻지 않는다. 계정을 확인할 수 없거나 다른 계정으로 고정해야 할 때만 사용자에게 GitHub login 또는 profile URL을 물어보고 `CLEVER_EXPECTED_GITHUB_LOGIN`에 넣는다.

```bash
python3 scripts/bootstrap_clever_work.py --cwd "$PWD" --preflight --json
```

repo 생성, ruleset 적용, branch protection 변경처럼 GitHub admin 권한이 필요한 단계는 대상 repo를 지정해 admin preflight를 다시 통과한다.

```bash
python3 scripts/bootstrap_clever_work.py \
  --cwd "$PWD" \
  --admin-preflight \
  --target-repo-full-name <target_repo_full_name> \
  --json
```

preflight는 최소한 `gh auth status`, gh CLI에서 확인한 GitHub login 또는 필요 시 사용자가 제공한 GitHub login/profile URL, `EVNSolution` org membership, `EVNSolution/*` origin, public repo, issue/PR/ruleset 조회 권한, clean worktree, remote fetch 접근을 확인한다.
새 repo 생성 권한은 destructive create 없이 완전히 증명할 수 없으므로, preflight 통과 후 `gh repo create` 성공 결과를 생성 proof로 본다.
출력의 `preflight_check.ready=true`를 확인한 뒤에만 구현 계획, repo bootstrap, 동시작업 gate 판정으로 내려간다.
실패하면 해당 단계로 내려가지 않는다.

## 저장소 역할

이 저장소는 구현 대상 repo다.

- 해석 정본: `clever-context-monorepo`
- 승인과 추적 정본: `clever-change-control`
- 시작과 bootstrap 정본: `clever-agent-project`

이 repo 안에서는 제품 코드, 테스트, 로컬 구현 문맥만 관리한다.
전역 규칙을 바꾸거나 서비스 정본을 갱신해야 하면 `clever-context-monorepo`에서 처리한다.

## 작업 시작 순서

새 세션 또는 새 이슈 작업을 시작하면 아래 순서로 진행한다.
비사소한 개발 작업에서는 이슈와 GitHub Development linked branch가 준비되기
전까지 구현, 커밋, PR 생성을 하지 않는다.

1. `git status --short --branch`로 branch와 dirty 상태를 확인한다.
2. target repository에 현재 작업을 대표하는 target issue를 생성하거나 확인한다.
3. 필요한 경우 `clever-change-control` repository에 대응 change-control issue를 생성하거나 확인한다.
4. target issue와 change-control issue를 서로 명시적으로 링크한다.
5. 브랜치는 반드시 target issue의 GitHub Development 기능으로 생성한다.
6. `gh issue develop --list`로 linked branch를 확인한다.
7. linked branch checkout 이후 `docs/project-brief.md`에서 프로젝트 목적과 제약을 확인한다.
8. 필요한 경우 `clever-context-monorepo/docs/services/<service>/index.md`를 읽는다.
9. 작업 전 변경 범위와 검증 방법을 짧게 정리한다.
10. 기능 변경 또는 버그 수정은 테스트를 먼저 추가한다.
11. 구현한다.
12. PR 생성 전 필수 검증 명령을 실행한다.
13. context monorepo 반영 필요 여부를 확인한다.
14. 완료 보고에 target issue, change-control issue, linked branch, PR, merge commit, 검증 결과, 남은 후속 작업을 남긴다.

### GitHub issue-linked branch 생성

수동으로 `git checkout -b`를 먼저 하지 않는다. CLI를 사용할 때는 반드시 아래
형식을 사용한다.

```bash
gh issue develop <target-issue-number> \
  --repo <target_repo_full_name> \
  --base dev \
  --name cc-<change-control-issue-number>-<short-scope> \
  --checkout
```

브랜치 생성 후 linked branch를 확인한다.

```bash
gh issue develop --list <target-issue-number> \
  --repo <target_repo_full_name>
```

예를 들어 target repo가 `EVNSolution/thundercrew-domain`이면 `--repo
EVNSolution/thundercrew-domain`과 `--base dev`를 사용한다.

## Branch 운영

- `main`: deploy branch다.
- `dev`: 통합 작업 branch다.
- task branch: 이슈 또는 작업 단위 branch다.

초기 remote bootstrap 후에는 `dev`를 만들고, 이후 일반 작업은 `dev` 또는 task branch에서 진행한다.
`dev`가 생긴 뒤에는 `main`에 직접 push하지 않는다.

첫 main push 전 필수 확인:

- target repo 루트 `AGENTS.md`가 존재해야 한다.
- 루트 `AGENTS.md`는 bootstrap source `docs/templates/target-repo-AGENTS.md` 내용이 반영된 agent 실행 절차서여야 한다.
- 위 항목이 빠졌거나 비어 있으면 첫 main push를 진행하지 않고, 먼저 seed 파일을 복사한 뒤 `git status --short`와 `git diff -- AGENTS.md`로 포함 여부를 확인한다.
- 첫 main push commit에는 루트 `AGENTS.md`를 반드시 포함한다. 확인 전에는 push하지 않는다.

### PR merge commit 제목

`main`으로 PR을 merge할 때는 GitHub 기본형 merge subject를 쓴다.
agent가 squash merge를 쓰는 경우에도 subject를 아래 형식으로 명시한다.

```bash
gh pr merge <pr-number> --squash \
  --subject "Merge pull request #<pr-number> from <owner>/<source-branch>" \
  --body-file <merge-body-file>
```

별도 커스텀 접두사는 쓰지 않는다.

### PR 완료 후 branch 정리

PR이 merge됐거나 source branch를 버리기로 하고 closed 처리된 뒤에는 task
branch를 정리한다. 단, 해당 branch가 아직 open PR, 후속 issue, child branch,
active release/hotfix에 쓰이면 삭제하지 않는다.

기본 명령은 아래 순서다.

```bash
git switch dev
git pull --ff-only origin dev
git branch -d <source-branch>
git push origin --delete <source-branch>
git fetch --prune origin
```

- `main`과 `dev`는 삭제 대상이 아니다.
- 기본은 `git branch -d <source-branch>`를 쓴다.
- merge 없이 닫은 branch를 폐기해야 할 때만 사용자 확인 후 `git branch -D <source-branch>`를 쓴다.
- remote branch가 GitHub에서 이미 삭제됐더라도 `git fetch --prune origin`으로 로컬 추적 branch를 정리한다.

### 다음 작업 이슈 생성 템플릿

main merge가 끝나고 관련 이슈/브랜치 정리까지 완료했으면 다음 작업을 시작하기 전에
사용자에게 아래 이슈 생성 템플릿을 전달한다. 사용자가 작성한 템플릿이나 기존 issue URL을
제공하기 전에는 새 구현 작업으로 넘어가지 않는다.

```markdown
[이슈 요약]:
[이슈 내용]:
[작업 유형]: [기능/버그/변경/리팩토링/문서/테스트/운영]
[대상 범위]: [서비스/화면/API/문서/설정]
[완료 기준]:
- [ ]
- [ ]
[검증 방법]:
- [ ]
[참고 링크/자료]:
- [ ]
```

## GitHub Ruleset 운영

새 프로젝트 repo는 public으로 만든다.
GitHub Free 조직에서 private repo ruleset은 enforce되지 않는다.

새 repo bootstrap 후 초기 `main` commit과 `dev` branch push가 끝나면 아래 명령으로 GitHub ruleset을 적용한다.

```bash
chmod +x scripts/apply-github-rulesets.sh
scripts/apply-github-rulesets.sh <target_repo_full_name>
```

표준 ruleset:

- main: PR 경유만 허용. direct push는 GitHub ruleset에서 막는다. 승인 수는 0명으로 둔다.
- dev: PR 경유만 허용. direct push는 GitHub ruleset에서 막는다.
- 승인 수는 둘 다 0명으로 고정한다.
- 그 외 branch: GitHub ruleset 미적용. 자유롭게 push할 수 있다.

적용 스크립트는 `gh api`를 사용한다.
실행 계정에는 target repo의 GitHub Administration write 권한이 필요하다.
private repo로 만들어야 하는 예외가 생기면 ruleset enforce가 되지 않는 리스크를 먼저 이슈에 남긴다.

## 브랜치 이름 규칙

비사소한 개발 작업의 branch 이름은 아래 형식으로 고정한다.

```text
cc-<change-control-issue-number>-<short-scope>
```

예:

```text
cc-74-dashboard-mapstate-frontend
```

규칙:

- branch는 항상 target issue의 GitHub Development 기능으로 생성한다.
- work branch는 항상 `dev`에서 시작한다.
- `git checkout -b`로 임의 branch를 먼저 만들지 않는다.
- GitHub Issue Development에 연결되지 않은 branch에서 작업하지 않는다.
- `dev` branch에서 직접 개발하거나 직접 commit하지 않는다.
- issue 없이 branch를 만들지 않는다.
- branch 없이 구현하지 않는다.
- PR 없이 `dev`에 반영하지 않는다.
- 내부 agent/tool 이름을 public commit, PR 제목, merge commit, GitHub attribution에 불필요하게 노출하지 않는다.
- `Co-authored-by: OmX` 같은 내부 자동화 attribution을 public dev history에 남기지 않는다.

브랜치 이름과 direct push를 로컬에서 보조적으로 확인하려면 target repo에서 아래
명령을 실행한다. 이 hook은 GitHub Development linked branch 확인을 대체하지
않는다.

```bash
cat > .git/hooks/pre-commit <<'EOF'
#!/bin/sh
branch="$(git rev-parse --abbrev-ref HEAD)"
case "$branch" in
  main|dev|cc-[0-9]*-*)
    exit 0
    ;;
  *)
    echo "Invalid branch name: $branch"
    echo "Use main, dev, or cc-<change-control-issue-number>-<short-scope>."
    exit 1
    ;;
esac
EOF
chmod +x .git/hooks/pre-commit

cat > .git/hooks/pre-push <<'EOF'
#!/bin/sh
branch="$(git rev-parse --abbrev-ref HEAD)"
case "$branch" in
  main|dev)
    echo "Direct pushes to $branch are blocked locally. Use a PR."
    exit 1
    ;;
  cc-[0-9]*-*)
    exit 0
    ;;
  *)
    echo "Invalid branch name: $branch"
    echo "Use cc-<change-control-issue-number>-<short-scope>."
    exit 1
    ;;
esac
EOF
chmod +x .git/hooks/pre-push
```

`pre-commit`은 잘못된 branch 이름에서 commit 생성을 막는다.
`pre-push`는 `main`/`dev` direct push와 잘못된 branch 이름 push를 막는다.

## Issue 연결 규칙

작업을 시작하기 전에 아래 연결을 확인한다.

- `clever-change-control` issue가 root `project-start issue`를 언급한다.
- target repo issue가 `clever-change-control` issue를 언급한다.
- branch 이름 또는 PR 설명에서 관련 issue를 추적할 수 있다.

GitHub 자동 링크만으로 충분하다고 보지 않는다.
이슈 코멘트 또는 PR 설명에 현재 상태, branch, commit, 다음 action을 명시한다.

## Concurrent Work Gate

구현을 시작하기 전, 그리고 PR을 열기 전에 target repo issue와
clever-change-control issue를 동시에 확인한다.

확인 대상:

- 같은 target repo issue 또는 같은 service issue
- 같은 clever-change-control issue 또는 연결된 project-start/change-request issue
- 같은 파일, API, 데이터 모델, 배포 경로를 건드리는 active branch
- 아직 merge되지 않은 open PR

판정은 아래 중 하나로 기록한다.

- `done`: 관련 이슈가 이미 merged/closed PR로 완료되어 현재 작업의 차단 대상이 아니다.
- `blocked`: 진행 중인 이슈, branch, open PR과 변경 범위가 겹쳐 진행하지 않는다.
- `allowed-with-non-overlap`: 진행 중인 이슈, branch, open PR이 있지만 service, API, data, deploy, file 범위가 겹치지 않는다고 에이전트가 판단했다.
- `user-forced-proceed`: 사용자가 `완전 무시모드`, `강제 진행`, `user-forced-proceed`를 명시했다. 이 모드에서는 동시 작업 충돌 게이트를 차단 조건으로 쓰지 않는다. 대신 conflict candidates, 예상 merge risk, 사용자 강제 진행 사실을 target repo issue, clever-change-control issue, PR 본문에 남기고 계속한다.

`user-forced-proceed`는 에이전트의 안전 판단이 아니다.
사용자 강제 진행 기록이며, 실제 git conflict, 테스트 실패, merge 실패가 발생하면 그 시점에 해결하거나 중단 보고한다.

## PR Scope Grouping Gate

PR을 열기 전에 현재 변경을 한 PR로 묶을지, 분리 PR로 나눌지 판단한다.

같은 issue 안에서 same document/operating-rule cleanup 축이고 same validation command로
충분하면 한 PR로 묶는다. 여러 정책 문서나 템플릿 파일을 같이
건드렸다는 이유만으로 작은 운영 문서 정리를 쪼개지 않는다.

한 PR로 묶는 기준:

- 같은 issue와 같은 document/operating-rule cleanup 축이다.
- 같은 validation command가 전체 변경을 검증한다.
- `AGENTS.md`, PR template, startup state template, project brief template,
  design source policy, merge title template sync처럼 같은 운영 규칙을 맞추는
  sync 대상이다.

분리 PR로 나누는 기준:

- different app/service/contract surface를 건드린다.
- 테스트 범위와 실패 지점이 다르다.
- merge order dependency가 있다.
- 실패 시 rollback unit이 다르다.

예: OpenAPI schema 변경, Admin Web smoke 화면, Rider App smoke 화면, Spring
service mock endpoint 구현은 보통 분리 PR로 다룬다.

## PR, merge, 검증, 보고 규칙

PR은 작업 branch에서 `dev`로 생성한다. PR 본문에는 target issue와
change-control issue를 명시한다. change-control issue가 필요 없다고 판단한
예외 작업은 그 사유를 target issue와 PR 본문에 남긴다.

기본 merge 방식은 GitHub PR trace가 `dev` history에서 명확히 보이는 방식을
우선한다. merge commit 방식을 권장한다. squash merge가 필요한 경우에도 commit
title에는 반드시 PR 번호를 포함한다.

예:

```text
Dashboard map-state frontend integration (#62)
```

금지:

- PR 번호 없는 squash commit
- `dev`에 직접 작성한 것처럼 보이는 commit title
- 출처가 불명확한 merge commit
- squash merge 남발

PR 생성 전 최소 검증:

```bash
npm run check:workspace
npm run lint
npm run typecheck
npm run build
```

프론트 테스트가 있으면 추가로 실행한다.

```bash
npm run test:service-ops
# 관련 frontend test command
```

백엔드를 건드렸으면 추가로 실행한다.

```bash
cd development/service-ops-api && ./gradlew test
cd development/service-ops-api && ./gradlew build
```

작업 보고는 항상 아래 기준으로 한다.

1. target issue 번호
2. change-control issue 번호
3. linked branch 이름
4. PR 번호
5. merge commit
6. 검증 명령 결과
7. 남은 후속 작업

PR merge 후 target issue와 change-control issue를 정리/close한다. merge 후 작업
branch는 local/remote 모두 삭제한다.

## 구현 규칙

- 기존 코드 스타일과 도구를 우선한다.
- 새 abstraction은 중복이나 복잡도를 실제로 줄일 때만 추가한다.
- config, env, deploy contract를 바꾸면 문서 반영 필요 여부를 같이 본다.
- public contract, API, 데이터 흐름이 바뀌면 서비스 문서 반영 여부를 확인한다.
- 큰 변경은 작은 작업 단위로 나눈다.

## 테스트와 검증 순서

코드 변경 후에는 최소한 아래를 확인한다.

1. 변경 범위에 가장 가까운 테스트
2. 관련 통합 테스트 또는 smoke test
3. formatter 또는 lint가 있는 경우 해당 명령
4. `git diff --check`
5. 실행 가능한 앱이면 로컬 실행 또는 브라우저 확인

테스트를 실행하지 못하면 완료 보고에 이유와 남은 리스크를 쓴다.

## Context 문서 반영 기준

이슈 해결 또는 PR 정리 전에는 `clever-context-monorepo` 반영 필요 여부를 확인한다.
`dev` 또는 `main`으로 올리는 PR은 `.github/PULL_REQUEST_TEMPLATE.md`의 PR 검토 에이전트 종료 조건을 반드시 채운다.

- 서비스 책임, API, 데이터 흐름, public contract가 바뀌면 service 문서 반영을 검토한다.
- deploy profile, runtime, env/secret category가 바뀌면 service 문서와 deploy 기준 반영을 검토한다.
- 빠른 탐색 링크나 요약이 필요할 때만 `docs/wiki`를 수정한다.
- PR 검토 에이전트 종료 조건: wiki/service context 업데이트로 마친다.
- PR 정보를 wiki에 올리지 않는다. wiki에는 정리된 서비스/운영 context만 반영한다.
- 문서 반영이 필요 없으면 PR 검토 완료 결과와 이슈 종료 코멘트에 불필요 사유를 남긴다.
- 이슈 종료는 PR 검토 완료 결과를 근거로 처리한다. 이슈 종료 시 같은 판단을 중복 작성하지 말고 PR의 wiki/service context 결과를 복사하거나 링크한다.

## 완료 조건

작업 완료 전 아래를 확인한다.

- 연결된 issue와 branch가 맞다.
- 의도한 파일만 변경됐다.
- 필요한 테스트를 실행했다.
- context 문서 반영 필요 여부를 확인했다.
- 완료 commit에는 source branch 정리 여부를 남긴다.
- 완료 보고에 변경 내용, 검증 결과, 다음 action을 남겼다.

## 금지 사항

- `AGENTS.md`를 프로젝트 기획서로 사용하지 않는다.
- `docs/project-brief.md`에 있어야 할 제품 설명을 이 파일에 길게 쓰지 않는다.
- `project-start issue #` 대신 임의의 change id를 root identifier로 쓰지 않는다.
- `dev`가 생긴 뒤 `main`에 직접 push하지 않는다.
- 사용자가 만들었을 수 있는 변경을 임의로 되돌리지 않는다.
