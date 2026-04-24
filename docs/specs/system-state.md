# System State

## State Design Principles

시스템은 업무 의미를 저장하지 않는다. 시스템이 저장하는 것은 **운영 연속성**에 필요한 최소 메타데이터뿐이다.

설계 원칙:

- GitHub Notifications는 신호 SoT다.
- GitHub Projects는 업무 SoT다.
- 시스템 상태 저장소는 운영 메타데이터만 가진다.
- 저장 포맷은 파일이든 sqlite든 바뀔 수 있지만 의미는 고정한다.

## session_state

`session_state`는 현재 실행 루프의 운영 상태를 나타낸다.

### Fields

| Field                         | Description                         |
| ----------------------------- | ----------------------------------- |
| agent_id                      | 에이전트 식별자                     |
| current_mode                  | `sleeping` 또는 `active`            |
| current_session_id            | 현재 실행 중인 세션 ID, 없으면 null |
| last_session_started_at       | 마지막 세션 시작 시각               |
| last_session_ended_at         | 마지막 세션 종료 시각               |
| last_notification_poll_at     | 마지막 notification poll 시각       |
| last_seen_notification_cursor | 마지막으로 본 notification 기준점   |
| wake_debounce_until           | 재기상 방지 시각                    |
| updated_at                    | 마지막 갱신 시각                    |

### Semantics

- `current_mode`는 현재 시스템 상태를 나타낸다.
- `current_session_id`는 active 상태에서만 값이 있을 수 있다.
- `last_seen_notification_cursor`는 중복 triage를 줄이기 위한 운영 기준점이다.
- `wake_debounce_until`은 과도한 재기상을 방지하는 데 사용한다.

## wake_decision

`wake_decision`은 각 wake 판단 기록을 남긴다.

### Fields

| Field                     | Description                            |
| ------------------------- | -------------------------------------- |
| id                        | 판단 레코드 ID                         |
| evaluated_at              | 평가 시각                              |
| previous_agent_mode       | 평가 직전 모드                         |
| unread_notification_count | unread notification 개수               |
| actionable_card_count     | Ready + Doing 카드 개수                |
| waiting_card_count        | Waiting 카드 개수                      |
| trigger_kind              | `unread`, `actionable`, `both`, `none` |
| should_wake               | 실제 wake 판단 결과                    |
| debounce_blocked          | debounce 때문에 막혔는지 여부          |
| wake_reason_summary       | 판단 요약 문자열                       |
| created_session_id        | 실제 세션을 열었으면 그 세션 ID        |
| selected_agent_class      | 선택된 agent class가 있으면 그 값      |

### Semantics

- wake_decision은 audit/debug 목적의 운영 로그다.
- 업무 의미를 담는 레코드가 아니다.
- 반드시 영구 저장할 필요는 없지만, 최근 N개는 유지하는 것을 권장한다.
- `selected_agent_class` 는 `default` 또는 `heavy` 로 남길 수 있다.
- heavy command가 비어 있어 기본 command로 폴백한 경우, selection 결과와 실제 실행 command class를 구분해 기록할 수 있다.

## Persistence Rules

- state는 `.gh-agent/` 아래 저장한다.
- writes는 가능한 한 atomic하게 수행한다.
- crash recovery를 고려해 partial write를 피해야 한다.
- `run` 시작 시 state가 없으면 초기화한다.

## What Is Explicitly Not Stored

아래 정보는 시스템 상태 저장소의 책임이 아니다.

- 어떤 notification이 중요한지에 대한 판단 의미
- 에이전트가 선택한 카드 제목과 업무 의미의 주 SoT
- 프로젝트 보드 전체 복사본
- `work/` 안의 파일 상태
- GitHub 댓글/커밋/PR 내용의 주 SoT
