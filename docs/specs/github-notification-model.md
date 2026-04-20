# GitHub Notification Model

## Purpose

이 문서는 GitHub Notifications를 어떻게 해석하고 사용할지 정의한다.

## Role of Notifications

GitHub Notifications는 이 시스템의 **신호 수신함(signal inbox)** 이다.

Notifications의 책임:

- GitHub 상에서 발생한 새 협업 신호를 드러낸다.
- 시스템이 “새로운 일이 생겼는가”를 판단할 수 있게 한다.
- 에이전트가 triage를 시작할 입력 큐 역할을 한다.

## Notification Fields We Care About

MVP에서 최소한으로 다루는 정보는 아래와 같다.

- unread/read
- thread URL
- reason
- subject
- repository
- updated timestamp 또는 polling 기준으로 쓸 수 있는 정렬 기준

이 필드들은 실제 구현에서 GitHub CLI 또는 API 응답 형식에 맞게 매핑한다.

## Unread/Read Semantics

### unread

- 아직 triage되지 않은 신호
- 에이전트가 아직 읽고 분류하지 않은 상태

### read

- triage가 완료된 신호
- 반드시 업무가 끝났다는 뜻은 아니다
- triage 후 무시, 즉시 응답, 카드 승격, 기존 카드 병합 중 하나가 이미 결정된 상태다

즉 read는 completion이 아니라 triage completion이다.

## Triage Outcomes

에이전트는 notification을 triage한 뒤 다음 중 하나를 선택한다.

### ignore

추적할 가치가 없고 별도 행동이 필요하지 않다.

### reply and close

짧은 응답 또는 즉시 처리로 끝낼 수 있다. project card를 만들지 않을 수 있다.

### promote to card

업무로 추적할 가치가 있으므로 project card를 새로 만든다.

### merge with existing card

이미 같은 thread 또는 같은 업무 맥락을 추적하는 카드가 있다면 그 카드에 병합한다.

## Promotion Rules

notification은 자동으로 project card가 되지 않는다.

카드로 승격하는 기준 예시:

- 후속 추적이 필요한 질문 또는 요청
- 한 세션 안에 끝나지 않을 가능성이 있는 조사/수정/구현 작업
- 사용자 응답, 리뷰 결과, CI 결과 등을 기다리며 계속 추적해야 하는 업무
- 다음 세션으로 이어져야 하는 열린 루프

카드로 승격하지 않는 예시:

- 단순 참고 알림
- 카드까지 만들 필요가 없는 짧은 응답
- 이미 종료된 맥락

## Rules for New Signal Detection

시스템은 notification의 **의미**를 해석하지 않는다. 시스템은 아래만 본다.

- unread notification 수
- last seen cursor 이후 새로운 신호가 있는지 여부

새 신호 감지 방식은 구현체에 따라 달라도 되지만 아래 원칙은 유지해야 한다.

- 중복 감지를 최소화해야 한다.
- 폴링 재시작 후에도 같은 신호를 안정적으로 다뤄야 한다.
- last seen cursor는 `.gh-agent/`에 저장한다.

## Thread URL Convention

notification과 project card를 연결할 때는 가능한 한 **canonical thread URL**을 기준으로 삼는다.

예:

- issue URL
- PR URL
- discussion URL

comment permalink는 필요 시 참조할 수 있지만, 카드의 기본 연결 키로는 canonical thread URL을 우선한다.
