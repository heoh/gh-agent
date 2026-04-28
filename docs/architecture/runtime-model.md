# Runtime Model

## Purpose

이 문서는 MVP의 런타임 구조를 고정한다. 구현자는 이 문서를 기준으로 프로세스 모델, 모드 전이, wake 판단, 세션 수명주기를 일관되게 구현해야 한다.

## Process Model

MVP는 **하나의 포그라운드 시스템 루프**로 동작한다.

- 평소에는 시스템이 포그라운드에서 GitHub를 폴링한다.
- wake 조건이 만족되면 같은 포그라운드에서 에이전트 세션을 실행한다.
- 에이전트 세션이 종료되면 시스템 제어가 돌아오고, 다시 폴링을 시작한다.

이 구조는 병렬성과 데몬 관리 복잡도를 줄이기 위한 설계다.

## Modes

시스템에는 최소 두 가지 모드가 있다.

### sleeping

- 에이전트 세션이 실행 중이지 않다.
- 시스템은 값싼 폴링만 수행한다.
- wake 조건을 계속 확인한다.

### active

- 에이전트 세션이 실행 중이다.
- 시스템 루프는 에이전트 실행 종료를 기다린다.
- 세션 종료 후 sleeping으로 돌아간다.

## Main Loop

기본 루프는 아래 순서를 따른다.

1. 현재 모드를 확인한다.
2. sleeping 상태라면 GitHub Notifications와 Projects 보드를 폴링한다.
3. unread 수와 actionable 카드 수를 계산한다.
4. wake 규칙을 평가한다.
5. should_wake=true이면 실행할 agent class를 선택한다.
6. 선택된 agent class에 맞는 agent session을 실행한다.
7. 세션 종료 후 운영 상태를 저장한다.
8. 다시 sleeping 폴링 루프로 복귀한다.

## Wake Decision

wake 판단의 기본 기준은 아래 두 가지다.

- unread notification count > 0
- actionable card count > 0

이 둘 중 하나라도 참이면 기본적으로 wake 후보가 된다.

다만 아래 보정 규칙이 필요하다.

- debounce window 안이면 즉시 재기상하지 않는다.
- 중복 실행 방지 락이 있으면 새 세션을 시작하지 않는다.
- Waiting만 있고 unread/actionable이 없으면 wake하지 않는다.

## Agent Selection

wake 여부와 어떤 에이전트를 실행할지는 별개다.

- wake 판단은 기존처럼 `unread > 0` 또는 actionable card 존재 여부로만 결정한다.
- wake가 확정되면 시스템은 `selectedAgentClass = default | heavy` 를 계산한다.

MVP selection 규칙은 아래와 같다.

- unread mailbox thread가 하나라도 있으면 기본적으로 `default` 에이전트를 선택한다.
- mailbox가 비어 있고 actionable(`Ready` 또는 `Doing`) 카드가 모두 `heavy` 클래스뿐이면 `heavy` 에이전트를 선택한다.
- mailbox가 비어 있고 actionable 카드에 `light` 카드가 하나라도 있으면 `default` 에이전트를 선택한다.
- mailbox가 비어 있고 actionable 카드가 `light/heavy` 혼합이면 `default` 에이전트를 선택한다.

즉, `heavy` 에이전트는 "메일함은 비었고 남은 actionable work가 heavy뿐인 경우"에만 우선적으로 기동된다.

## Agent Capabilities

### default

- 기본 에이전트는 `executionClass !== heavy` 인 작업카드만 처리 대상으로 본다.
- mailbox triage가 필요한 세션은 기본적으로 이 에이전트가 맡는다.

### heavy

- heavy 에이전트는 모든 작업카드를 처리할 수 있다.
- 세션이 시작되면 `Ready/Doing` 중 `heavy` 클래스 작업을 먼저 우선 처리한다.

## Agent Commands

workspace config는 실행 명령을 아래 두 필드로 가진다.

- `defaultAgentCommand: string`
- `heavyAgentCommand: string | null`

MVP에서는 둘 다 쉘에서 바로 실행 가능한 command string으로 취급한다.

- `agentId`는 식별자이며 실행 커맨드의 대체물이 아니다.
- preset selection은 `init` UX에서만 사용된다. 실제 저장/실행 source of truth는 `defaultAgentCommand` 문자열이다.
- `defaultAgentCommand` 기본값은 `codex exec --config sandbox_workspace_write.network_access=true --full-auto "$GH_AGENT_PROMPT"` 다.
- command 안의 prompt 부분은 시스템이 이번 세션에 수행할 행동 가이드를 동적으로 생성해 주입한다.
- 런타임은 항상 `GH_AGENT_HOME=<workspace root>` 를 agent process env에 주입한다.
- `heavyAgentCommand` 기본값은 `null` 이다.
- preset이 isolated config env를 지원하면 런타임은 `GH_AGENT_HOME` 값을 해당 CLI env (`CODEX_HOME`, `COPILOT_HOME`, `GEMINI_CLI_HOME`, `CURSOR_CONFIG_DIR`, `CLINE_DIR`) 로 주입한다.
- Claude preset은 현재 gh-agent가 별도 isolated config env를 주입하지 않는다.
- preset은 편의 기능일 뿐이며, CLI 설치/auth/healthcheck는 gh-agent 범위 밖이다.

### Heavy Command Fallback

- selection 결과가 `heavy` 여도 `heavyAgentCommand`가 비어 있으면 `defaultAgentCommand`로 폴백한다.
- 이 규칙은 MVP 운영 단순화를 위한 것이다.
- 실제 selection 구현에는 actionable 카드의 execution class 분포를 알 수 있는 추가 요약 또는 카드 목록 조회가 필요하다.

## Agent Session Lifecycle

에이전트 세션은 다음 단계를 따른다.

1. 시스템이 세션 ID를 발급한다.
2. 시스템이 브리핑 문맥을 준비한다.
3. 시스템이 `selectedAgentClass`를 계산한다.
4. 시스템이 해당 command string으로 에이전트 CLI를 실행한다.
5. 에이전트가 triage, board update, GitHub actions를 수행한다.
6. 에이전트가 종료한다.
7. 시스템이 종료 상태를 기록한다.
8. 시스템이 sleeping 폴링으로 돌아간다.

## Return to Poll

에이전트 세션이 정상 종료되든 비정상 종료되든 시스템은 다시 polling 가능한 상태로 복귀해야 한다.

필수 요구사항:

- active 모드를 해제한다.
- 세션 종료 시각을 저장한다.
- 락을 정리한다.
- 다음 debounce 시각을 계산한다.
- 루프를 재개한다.

## Debounce and Locking

### Debounce

연속된 짧은 간격의 신호 때문에 에이전트가 불필요하게 자주 깨어나는 것을 막기 위한 장치다.

### Locking

같은 workspace에서 두 개 이상의 `run` 인스턴스가 동시에 동작하지 않도록 해야 한다.

최소 요구사항:

- `.gh-agent/lock` 또는 동등한 파일 기반 락
- 비정상 종료 후 stale lock 복구 규칙
- 이미 실행 중이면 명확한 에러 출력

## Why This Model

이 런타임 모델을 택하는 이유는 아래와 같다.

- MVP 범위에서 가장 단순하다.
- 시스템/에이전트의 책임 경계가 선명하다.
- local CLI 기반 사용자 경험과 잘 맞는다.
- 운영 상태 저장 모델이 단순해진다.
- 나중에 daemon 구조로 확장하더라도 현재 모델 위에서 진화시킬 수 있다.
