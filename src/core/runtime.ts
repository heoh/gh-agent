import type { Config, SessionState, SignalSummary, WakeDecision } from './types.js';

export function getMockSignalSummary(): SignalSummary {
  return {
    unreadCount: 1,
    actionableCount: 0,
  };
}

export function evaluateWakeDecision(
  state: SessionState,
  signals: SignalSummary,
  now = new Date(),
): WakeDecision {
  const hasUnread = signals.unreadCount > 0;
  const hasActionable = signals.actionableCount > 0;
  const nextWakeNotBefore =
    state.nextWakeNotBefore === null ? null : new Date(state.nextWakeNotBefore);
  const blockedByCooldown =
    nextWakeNotBefore !== null && nextWakeNotBefore.getTime() > now.getTime();

  const triggerKind = hasUnread && hasActionable
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

export function startSession(state: SessionState, sessionId: string): SessionState {
  return {
    ...state,
    currentMode: 'active',
    currentSessionId: sessionId,
  };
}

export function finishSession(state: SessionState, config: Config, now = new Date()): SessionState {
  const nextWakeNotBefore = new Date(now.getTime() + config.debounceMs).toISOString();

  return {
    ...state,
    currentMode: 'sleeping',
    currentSessionId: null,
    nextWakeNotBefore,
  };
}