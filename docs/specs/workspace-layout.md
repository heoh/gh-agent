# Workspace Layout

## Purpose

이 문서는 로컬 workspace 구조를 정의한다. 모든 구현은 이 구조를 기준으로 동작해야 한다.

## Top-level Structure

기본 구조는 아래와 같다.

```text
agent-workspace/
  work/
  .gh-agent/
    config.json
    session_state.json
    wake_decisions.jsonl
    lock
```

## .gh-agent/config.json

`.gh-agent/config.json`은 workspace-local 사용자 및 실행 기본 설정을 담는다.

예상 항목 예시:

- agent identifier
- default agent preset
- default agent command
- heavy agent command
- polling interval
- GitHub 관련 설정
- 기본 workspace 정책
- CLI 옵션의 기본값

이 파일은 사람이 읽고 수정 가능한 형식을 유지하는 것이 좋다.
루트에 두는 전역 성격의 설정 파일이 아니라, 현재 workspace에 귀속되는 런타임 설정 파일이다.

예시:

```json
{
  "agentId": "gh-agent",
  "defaultAgentCommand": "copilot -p \"$GH_AGENT_PROMPT\"",
  "heavyAgentCommand": null,
  "pollIntervalMs": 30000,
  "debounceMs": 60000
}
```

실행 명령 관련 규칙:

- `agentId`는 식별자다. 실제 실행 커맨드는 `defaultAgentCommand` 와 `heavyAgentCommand` 가 담당한다.
- preset choice는 init 시 `defaultAgentCommand` 를 채우기 위한 UX이고, config에는 별도로 저장하지 않는다.
- `defaultAgentCommand` 는 항상 문자열이어야 하며 MVP 기본값은 `copilot -p "$GH_AGENT_PROMPT"` 다.
- command의 prompt 부분은 시스템이 세션마다 동적으로 생성한 행동 가이드를 주입하는 자리다.
- 런타임은 모든 agent session에 `GH_AGENT_HOME=<workspace root>` env를 제공한다.
- `defaultAgentCommand` 는 반드시 `$GH_AGENT_PROMPT` placeholder를 포함해야 한다.
- `heavyAgentCommand` 는 문자열 또는 `null` 이다.
- heavy command가 `null` 인 경우, heavy 에이전트가 선택되어도 시스템은 기본 command로 폴백할 수 있다.

## work/

`work/`는 에이전트 자유 작업 공간이다.

허용되는 사용 예:

- 여러 저장소 clone
- scratch 파일 생성
- 테스트 출력 저장
- 임시 스크립트 작성
- 브랜치 작업

중요 원칙:

- 시스템은 `work/`를 해석하지 않는다.
- `work/`는 운영 상태 판단의 SoT가 아니다.
- 작업 조직 방식은 에이전트 재량에 맡긴다.

운영 권장 규칙:

- 기본 작업 폴더는 `work/{org}-{repo}[-{task}]` 형식을 권장한다.
- 이 규칙은 강제가 아니라 혼선 방지를 위한 기본 가이드다.
- 예시:
  - 작업 시작: `work/acme-api-pr123`
  - 작업 종료(원격 반영 후): 폴더 삭제

종료 작업 정리 규칙:

- `work/`는 활성 작업 중심으로 유지한다.
- 종료 작업은 `archive`보다 삭제를 기본으로 한다.
- 삭제 전 아래 3조건을 모두 충족해야 한다.
  - 원격 반영 완료: merge/close 등으로 GitHub에 최종 상태가 남아 있다.
  - 로컬 작업 트리 clean: 의도치 않은 미반영 변경이 없다.
- 조건이 불확실하면 임시 보관은 허용되며, 영구 보관이 아니라 확인 대기 상태로 관리한다.

## .gh-agent/

`.gh-agent/`은 시스템 내부 메타데이터를 저장한다.

보관 후보:

- session state
- wake decision logs
- last poll timestamp
- last seen notification cursor
- lock file
- 최근 에러/운영 로그

권장 예시:

```text
.gh-agent/
  config.json
  session_state.json
  wake_decisions.jsonl
  lock
  logs/
```

## Locking and Logs

### Locking

동일 workspace에서 둘 이상의 `run` 인스턴스가 동시에 실행되지 않도록 `.gh-agent/lock` 또는 이에 준하는 락을 둔다.

### Logs

운영 로그는 `.gh-agent/logs/` 아래에 두는 것을 권장한다.

로그의 목적:

- poll/wake/session 디버깅
- crash 분석
- 최근 동작 추적

## Source of Truth Boundaries

- GitHub Notifications: 신호 SoT
- GitHub Projects: 업무 SoT
- `.gh-agent/`: 운영 연속성 메타데이터
- `work/`: 실행 공간

이 경계를 넘어서 구현하면 책임이 흐려지고 상태 중복이 늘어난다.
