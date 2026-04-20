# CLI Spec

## Purpose

이 문서는 MVP CLI 인터페이스를 정의한다.

MVP는 npm 패키지로 배포되는 CLI를 전제로 하며, 사용자는 workspace를 만든 뒤 같은 workspace 안에서 시스템 루프를 실행한다.

## Command Overview

최소 명령은 아래 세 가지다.

- `init`
- `run`
- `status`

## init

### Purpose

새 workspace를 생성하고 초기 실행 가능 상태를 만든다.

### Responsibilities

- workspace 디렉토리 구조 생성
- `config.json` 초기화
- `.gh-agent/` 초기화
- GitHub 인증 준비 또는 `gh auth login` 유도
- 필수 설정 검증

### Inputs

예상 입력 예시:

- workspace path
- agent name 또는 identifier
- polling interval 기본값

### Side Effects

- `config.json` 생성
- `work/` 생성
- `.gh-agent/` 생성
- 초기 state 파일 생성 가능

### Output

- 생성된 workspace 경로
- 다음 실행 방법 안내 (`run`)
- 인증 상태 또는 필요한 후속 조치

## run

### Purpose

포그라운드 시스템 루프를 시작한다.

### Responsibilities

- 락 획득
- current mode 초기화/복원
- notification poll
- project board actionable 확인
- wake decision 평가
- 필요 시 agent session 실행
- 세션 종료 후 polling으로 복귀

### Main Loop Behavior

`run`은 아래 전체를 포함하는 메인 엔트리포인트다.

1. state 로드
2. lock 획득
3. poll notifications
4. inspect project board
5. evaluate wake decision
6. if needed, launch agent session
7. record session end
8. return to poll

### Output

stdout에는 사람이 읽을 수 있는 최소 운영 로그를 출력한다.

예시:

- polling started
- unread=2 actionable=1 should_wake=true
- session started: sess\_...
- session ended
- back to polling

### Exit Conditions

- 사용자가 명시적으로 종료
- 복구 불가능한 초기화 에러
- lock 획득 실패

정상 종료 시 시스템은 lock과 active 상태를 정리해야 한다.

## status

### Purpose

현재 workspace의 운영 상태를 빠르게 조회한다.

### Suggested Output Fields

- current mode
- last poll time
- last session started/ended time
- unread summary
- actionable summary
- debounce until
- lock status

## Exit Codes

권장 초안:

- `0`: success
- `1`: generic runtime error
- `2`: configuration error
- `3`: authentication error
- `4`: lock already held

## Logging Principles

- 로그는 운영 흐름을 이해할 수 있을 정도로만 출력한다.
- 고수준 이벤트 중심으로 남긴다.
- GitHub 협업 내용 자체보다 poll/wake/session lifecycle 위주로 남긴다.
- 상세 디버그 로그가 필요하면 `.gh-agent/logs/`로 보낸다.
