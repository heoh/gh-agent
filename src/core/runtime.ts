import type {
  Config,
  SessionState,
  SignalSummary,
  WakeDecision,
} from './types.js';

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
