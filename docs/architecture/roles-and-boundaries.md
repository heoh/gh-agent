# Roles and Boundaries

## Purpose

이 문서는 사용자, GitHub, 시스템, 에이전트의 역할을 분리하고 책임 경계를 고정한다.
구현 중 가장 흔한 혼란은 “누가 triage하는가”, “누가 카드를 만드는가”, “무엇이 SoT인가”에서 발생하므로, 이 문서는 그 기준을 제공한다.

## Actors

### User

사용자는 에이전트와 협업하는 사람이다.

사용자의 역할:

- GitHub에서 이슈, PR, 댓글, 리뷰 요청, 멘션 등으로 말을 건다.
- 작업 요청, 질문, 피드백, 결정을 제공한다.
- 에이전트의 결과를 확인하고 후속 지시를 준다.

사용자는 별도의 에이전트 전용 UI를 다루지 않는다. 기본 경험은 GitHub 안에서 끝나야 한다.

### GitHub

GitHub는 단순 저장소가 아니라 협업의 실제 무대다.

GitHub의 역할:

- 사용자와 에이전트가 상호작용하는 장소가 된다.
- notification, issue, PR, review, mention, assignment 등 협업 신호를 제공한다.
- 에이전트의 응답, 리뷰, 커밋, 브랜치, PR, 댓글 같은 결과가 기록되는 장소가 된다.

즉 GitHub는 입력 채널이자 출력 채널이다.

### System

시스템은 에이전트가 아니다. 시스템은 에이전트가 하루를 운영할 수 있게 해주는 운영 레이어다.

시스템의 역할:

- GitHub Notifications를 폴링한다.
- 개인 GitHub Projects 보드의 actionable 상태를 확인한다.
- 에이전트 세션 시작 여부를 결정한다.
- 수면/기상 상태를 관리한다.
- 세션 시작 시 브리핑 문맥을 준비한다.
- 세션 종료 후 운영 상태를 저장한다.
- 중복 기상, 중복 실행, 루프 오작동을 방지한다.

### Agent

에이전트는 실제 협업자다.

에이전트의 역할:

- GitHub Notifications를 triage한다.
- 어떤 신호가 업무로 승격될 가치가 있는지 판단한다.
- 개인 GitHub Projects 보드에 카드를 생성·갱신·이동한다.
- 우선순위를 정하고 작업한다.
- GitHub에서 질문, 응답, 리뷰, 구현, 보고를 수행한다.
- 세션 종료 전 다음에 이어질 문맥을 정리한다.

## Responsibility Matrix

| Concern                | User | GitHub         | System | Agent |
| ---------------------- | ---- | -------------- | ------ | ----- |
| 협업 요청 생성         | Yes  | Surface only   | No     | No    |
| 신호 전달              | No   | Yes            | Polls  | Reads |
| notification triage    | No   | No             | No     | Yes   |
| project card 생성/이동 | No   | Stores         | No     | Yes   |
| wake/sleep 판단        | No   | Source only    | Yes    | No    |
| 실제 작업 수행         | No   | Records result | No     | Yes   |
| 운영 상태 저장         | No   | Partial        | Yes    | No    |

## What the System Must Do

시스템은 다음을 반드시 수행해야 한다.

- unread notification 존재 여부 확인
- actionable card 존재 여부 확인
- 기상 여부 판단
- sleeping / active 모드 추적
- 세션 간 최소 운영 상태 보존
- 중복 실행 방지

## What the System Must Not Do

시스템은 다음을 수행하지 않는다.

- notification의 의미 해석
- 어떤 신호가 진짜 할 일인지 최종 판단
- project card 생성/이동/삭제
- 작업 우선순위 결정
- GitHub 댓글, 리뷰, 코드 변경, 커밋 작성
- 에이전트 업무 기록을 자체 DB의 주 SoT로 보관

## What the Agent Owns

에이전트는 아래 책임을 소유한다.

- triage 정책 실행
- project card 운영
- 작업 진행 상태 반영
- GitHub 협업 행동 수행
- 다음 세션을 위한 업무 문맥 정리

## Source of Truth Rules

### 1. GitHub Notifications are the signal SoT

notification의 unread/read 상태는 triage 상태를 의미한다.

### 2. GitHub Projects is the work SoT

업무로 승격된 항목의 현재 상태는 개인 GitHub Projects 보드가 표현한다.

### 3. `.gh-agent/` stores operational continuity only

`.gh-agent/`은 운영 연속성에 필요한 메타데이터만 저장한다. 업무 의미의 주 SoT가 아니다.

### 4. `work/` is execution space, not a state database

`work/`는 에이전트가 자유롭게 클론하고 작업하는 공간이다. 시스템은 이 디렉토리를 해석하지 않는다.
