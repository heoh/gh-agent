# GitHub Project Board

## Board Purpose

개인 GitHub Projects 보드는 에이전트의 **개인 업무판**이다.

이 보드는 notification 수신함이 아니다. notification은 GitHub Notifications에서 triage하고, 업무로 추적할 가치가 있는 항목만 카드로 승격한다.

보드의 목적:

- 업무 상태를 외부화한다.
- 세션 간 연속성을 유지한다.
- 다음에 할 행동을 보존한다.
- 시스템이 actionable work 존재 여부를 관찰할 수 있게 한다.

## Columns

### Ready

지금 바로 시작 가능한 업무.

### Doing

현재 세션에서 실제로 작업 중인 업무.

### Waiting

추적은 필요하지만 외부 입력/조건 충족 전에는 시작할 수 없는 업무.

### Done

현재 세션 기준으로 종료된 업무.

## What Counts as Actionable

actionable item은 아래 두 컬럼에 있는 카드로 정의한다.

- Ready
- Doing

아래는 actionable이 아니다.

- Waiting
- Done

시스템은 wake 판단 시 Ready + Doing 개수만 사용한다.

## Field Definitions

### Title

다음 세션에 다시 봐도 바로 이해 가능한 작업 제목.

### Status

허용값:

- Ready
- Doing
- Waiting
- Done

### Priority

허용값:

- P1
- P2
- P3

의미:

- P1: 빠른 대응 필요
- P2: 일반 우선순위
- P3: 늦어도 되지만 추적 필요

### Type

허용값:

- interaction
- execution

의미:

- interaction: 질문 응답, 리뷰 회신, 설명, 조율 중심
- execution: 조사, 재현, 수정, 구현, 테스트, 문서 변경 중심

### Source Link

카드가 생성된 원 신호의 canonical thread URL.

### Next Action

다음 세션에서 바로 이어질 수 있도록, 가장 구체적인 다음 행동 한 줄.

### Short Note

짧은 보충 메모 또는 상태 메모.

## Card Creation Rules

카드는 notification을 자동 복제하지 않는다.
에이전트가 업무로 추적할 가치가 있다고 판단할 때만 만든다.

생성 시 초기 상태는 아래 둘 중 하나다.

- Ready
- Waiting

Inbox 컬럼은 두지 않는다.

## Card Transition Rules

### Ready → Doing

현재 세션에서 실제로 잡아서 작업을 시작할 때.

### Doing → Waiting

진행 중 외부 입력/조건을 기다리게 되었을 때.

### Doing → Done

GitHub에 필요한 행동까지 완료되어 현재 세션 기준 종료되었을 때.

### Waiting → Ready

기다리던 정보나 조건이 충족되어 다시 바로 시작 가능해졌을 때.

### Ready → Done

짧은 응답만으로 즉시 종료되었거나, 생성 직후 더 이상 추적할 필요가 없어졌을 때 예외적으로 허용.

## Source Link Convention

Source Link는 comment permalink보다 **thread 단위 canonical URL**을 우선한다.

예:

- `https://github.com/org/repo/issues/123`
- `https://github.com/org/repo/pull/456`

## Ownership Rules

- 보드는 에이전트가 소유한다.
- 카드 생성/이동/정리는 에이전트 책임이다.
- 시스템은 보드 상태를 읽기만 한다.
- Done 정리와 아카이빙 시점은 에이전트가 판단한다.
