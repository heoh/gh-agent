import type {
  AgentClass,
  Config,
  TaskListItem,
  SessionState,
  SignalSummary,
  WakeDecision,
} from './types.js';

export const PROMPT_MAILBOX_SAMPLE_LIMIT = 20;
export const PROMPT_TASK_SAMPLE_LIMIT = 20;
export const PROMPT_RECENT_TASK_CARD_LIMIT = 5;

function parseIsoDate(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function evaluateWakeDecision(
  state: SessionState,
  signals: SignalSummary,
  now = new Date(),
): WakeDecision {
  const hasUnread = signals.unreadCount > 0;
  const hasActionable = signals.actionableCount > 0;
  const nextWakeNotBefore = parseIsoDate(state.nextWakeNotBefore);
  const blockedByCooldown =
    nextWakeNotBefore !== null && nextWakeNotBefore.getTime() > now.getTime();

  const triggerKind =
    hasUnread && hasActionable
      ? 'both'
      : hasUnread
        ? 'unread'
        : hasActionable
          ? 'actionable'
          : 'none';

  if (triggerKind === 'none') {
    return {
      shouldWake: false,
      blockedByCooldown: false,
      reason: 'no unread notifications or actionable cards',
      triggerKind,
    };
  }

  if (blockedByCooldown) {
    return {
      shouldWake: false,
      blockedByCooldown: true,
      reason: `wake blocked until ${nextWakeNotBefore?.toISOString()}`,
      triggerKind,
    };
  }

  return {
    shouldWake: true,
    blockedByCooldown: false,
    reason: `wake triggered by ${triggerKind}`,
    triggerKind,
  };
}

export function createSessionId(now = new Date()): string {
  return `sess_${now.getTime()}`;
}

export function startSession(
  state: SessionState,
  sessionId: string,
  now = new Date(),
): SessionState {
  return {
    ...state,
    currentMode: 'active',
    currentSessionId: sessionId,
    nextWakeNotBefore: null,
    lastSessionStartedAt: now.toISOString(),
  };
}

export function finishSession(
  state: SessionState,
  config: Config,
  now = new Date(),
): SessionState {
  const nextWakeNotBefore = new Date(
    now.getTime() + config.debounceMs,
  ).toISOString();

  return {
    ...state,
    currentMode: 'sleeping',
    currentSessionId: null,
    nextWakeNotBefore,
    lastSessionEndedAt: now.toISOString(),
  };
}

export function recordNotificationPoll(
  state: SessionState,
  now = new Date(),
  cursor: string | null = null,
): SessionState {
  return {
    ...state,
    lastNotificationPollAt: now.toISOString(),
    lastSeenNotificationCursor: cursor,
  };
}

export function selectAgentClass(
  unreadNotificationCount: number,
  actionableTasks: TaskListItem[],
): AgentClass {
  if (unreadNotificationCount > 0) {
    return 'default';
  }

  if (actionableTasks.length === 0) {
    return 'default';
  }

  const allHeavy = actionableTasks.every(
    (task) => task.executionClass === 'heavy',
  );

  return allHeavy ? 'heavy' : 'default';
}

export function resolveAgentExecution(
  config: Config,
  selectedAgentClass: AgentClass,
): {
  executedAgentClass: AgentClass;
  command: string;
} {
  if (selectedAgentClass === 'heavy' && config.heavyAgentCommand !== null) {
    return {
      executedAgentClass: 'heavy',
      command: config.heavyAgentCommand,
    };
  }

  return {
    executedAgentClass: 'default',
    command: config.defaultAgentCommand,
  };
}

function formatMailboxSamples(
  samples: Array<{
    id: string;
    repositoryFullName: string;
    title: string;
    reason: string;
  }>,
): string {
  if (samples.length === 0) {
    return '- 없음';
  }

  return samples
    .map(
      (sample) =>
        `- ${sample.id} | ${sample.repositoryFullName} | ${sample.reason} | ${sample.title}`,
    )
    .join('\n');
}

function formatTaskSamples(
  samples: Array<{
    id: string;
    status: string;
    executionClass: string | null;
    title: string;
    sourceLink: string | null;
    nextAction: string | null;
    shortNote: string | null;
  }>,
): string {
  if (samples.length === 0) {
    return '- 없음';
  }

  return samples
    .map(
      (sample) =>
        `- ${sample.id} | ${sample.status} | class=${sample.executionClass ?? 'null'} | ${sample.title} | source=${sample.sourceLink ?? 'null'} | next=${sample.nextAction ?? 'null'} | note=${sample.shortNote ?? 'null'}`,
    )
    .join('\n');
}

function formatRecentUpdatedTaskCards(
  cards: Array<{
    id: string;
    updatedAt: string | null;
    status: string;
    executionClass: string | null;
    title: string;
    sourceLink: string | null;
    nextAction: string | null;
    shortNote: string | null;
  }>,
): string {
  if (cards.length === 0) {
    return '- 없음';
  }

  return cards
    .map(
      (card) =>
        `- ${card.id} | updatedAt=${card.updatedAt ?? 'null'} | ${card.status} | class=${card.executionClass ?? 'null'} | ${card.title} | source=${card.sourceLink ?? 'null'} | next=${card.nextAction ?? 'null'} | note=${card.shortNote ?? 'null'}`,
    )
    .join('\n');
}

export function buildRichSessionPrompt(input: {
  sessionId: string;
  wakeReason: string;
  triggerKind: WakeDecision['triggerKind'];
  selectedAgentClass: AgentClass;
  executedAgentClass: AgentClass;
  unreadCount: number;
  actionableCount: number;
  mailboxSamples: Array<{
    id: string;
    repositoryFullName: string;
    title: string;
    reason: string;
  }>;
  actionableTaskSamples: Array<{
    id: string;
    status: string;
    executionClass: string | null;
    title: string;
    sourceLink: string | null;
    nextAction: string | null;
    shortNote: string | null;
  }>;
  recentUpdatedTaskCards: Array<{
    id: string;
    updatedAt: string | null;
    status: string;
    executionClass: string | null;
    title: string;
    sourceLink: string | null;
    nextAction: string | null;
    shortNote: string | null;
  }>;
  mailboxSampleLimit: number;
  taskSampleLimit: number;
  recentTaskCardLimit: number;
}): string {
  return [
    '당신은 gh-agent 세션을 수행하는 실행 에이전트다.',
    '',
    '[세션 루틴]',
    '1) mailbox triage -> 2) actionable task 처리 -> 3) 새 mailbox 재확인',
    '',
    '[gh-agent 핵심 명령 가이드]',
    '- mailbox: gh-agent mailbox list | show <threadId> | promote <threadId...> | ignore <threadId...>',
    '- task: gh-agent task list | show <taskId> | create ... | update <taskId> ... | ready/doing/wait/done <taskId...>',
    '- 상태 확인: gh-agent status',
    '',
    '[GitHub 소통 원칙]',
    '- gh CLI를 사용해 이슈/PR 코멘트, 리뷰 응답, 상태 공유를 수행한다.',
    '- 중요한 결정, 진행상황, 블로커는 GitHub 상에 사용자에게 남긴다.',
    '',
    '[작업 공간 원칙]',
    '- 현재 workspace 안에서 자율적으로 행동한다.',
    '- 필요하면 repo clone, 브랜치 생성, 검증을 직접 수행한다.',
    '- work/ 포함 로컬 파일시스템을 실행 공간으로 적극 활용한다.',
    '',
    '[현재 세션 컨텍스트]',
    `- sessionId: ${input.sessionId}`,
    `- wakeReason: ${input.wakeReason}`,
    `- triggerKind: ${input.triggerKind}`,
    `- selectedAgentClass: ${input.selectedAgentClass}`,
    `- executedAgentClass: ${input.executedAgentClass}`,
    `- unreadCount: ${input.unreadCount}`,
    `- actionableCount: ${input.actionableCount}`,
    '',
    `[mailbox 샘플 최대 ${input.mailboxSampleLimit}개]`,
    formatMailboxSamples(input.mailboxSamples),
    '',
    `[actionable task 샘플 최대 ${input.taskSampleLimit}개]`,
    formatTaskSamples(input.actionableTaskSamples),
    '',
    `[recent updated task cards 최대 ${input.recentTaskCardLimit}개]`,
    formatRecentUpdatedTaskCards(input.recentUpdatedTaskCards),
    '',
    '위 지침을 기반으로 지금 세션에서 필요한 triage/작업/소통을 수행하라.',
  ].join('\n');
}
