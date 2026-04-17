# MVP Goal

## One-line Thesis

이 프로젝트의 MVP는 **GitHub 안에서 항상 살아 있고 반응하는 AI 기여자 계정**을 성립시키는 것이다.

이 프로젝트는 단순한 코드 생성 도구를 만드는 것이 아니다. 목표는 사용자가 별도 앱이나 전용 UI로 이동하지 않고, GitHub의 이슈·PR·댓글·멘션·리뷰 요청 안에서 에이전트와 협업할 수 있게 만드는 것이다.

## What the MVP Proves

MVP가 증명하려는 것은 아래 4가지다.

1. 에이전트 계정이 GitHub 안에서 지속적으로 대기할 수 있다.
2. 시스템이 GitHub 상의 신호를 감지해 필요할 때만 에이전트를 깨울 수 있다.
3. 에이전트가 GitHub 문맥 안에서 실제 협업 행동을 수행할 수 있다.
4. 에이전트가 세션이 끝난 뒤에도 다음 세션으로 이어지는 작업 맥락을 유지할 수 있다.

즉 이번 단계의 핵심은 **상시성**, **반응성**, **세션 연속성**, **GitHub-native 경험**이다.

## Success Criteria

MVP는 아래 조건을 만족하면 성공으로 본다.

- 시스템이 GitHub Notifications와 개인 GitHub Projects 보드를 기준으로 에이전트 기상 여부를 결정한다.
- 할 일이 없을 때는 시스템이 에이전트를 수면 상태로 유지한다.
- unread 신호나 actionable 카드가 생기면 에이전트를 다시 기상시킨다.
- 에이전트가 GitHub에서 triage, 응답, 조사, 수정, 보고 같은 협업 행동을 수행한다.
- 에이전트가 개인 보드를 사용해 다음에 이어질 업무를 보존한다.
- 전체 루프가 하나의 로컬 workspace 안에서 CLI 기반으로 구동된다.

## Non-goals

이번 MVP에서 일부러 하지 않는 것은 아래와 같다.

- 사람처럼 보이는 말투 최적화
- 고도 자율 계획 수립 능력
- 장기 전략 설계 능력
- 여러 병렬 작업자/분산 실행기 설계
- GitHub App 기반의 정식 통합
- 고급 분석 대시보드
- 범용 에이전트 플랫폼화

즉 이번 단계는 “얼마나 똑똑한가”보다 “GitHub 협업자처럼 살아 있는가”를 먼저 검증한다.

## Design Principles

### 1. GitHub-native first
모든 핵심 상호작용은 GitHub 안에서 일어나야 한다.

### 2. Cheap while sleeping
할 일이 없을 때는 값싼 폴링만 수행하고, 에이전트 세션은 필요할 때만 시작한다.

### 3. System and agent are separate layers
시스템은 감시·기상·세션 연속성을 담당하고, 에이전트는 판단과 실제 협업 행동을 담당한다.

### 4. Externalize working memory
에이전트의 업무 상태는 GitHub Projects 보드로 외부화한다.

### 5. Prefer simple runtime over clever runtime
MVP에서는 병렬성과 백그라운드 인프라보다 단일 포그라운드 루프를 우선한다.
