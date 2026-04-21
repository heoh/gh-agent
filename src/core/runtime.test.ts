import { describe, expect, it } from 'vitest';

import {
  createSessionId,
  evaluateWakeDecision,
  finishSession,
  recordNotificationPoll,
  startSession,
} from './runtime.js';
import { createInitialSessionState } from './workspace.js';

describe('wake decision', () => {
  it('wakes when unread notifications exist and cooldown is clear', () => {
    const state = createInitialSessionState(
      'gh-agent',
      new Date('2026-04-17T17:00:00.000Z'),
    );
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 1, actionableCount: 0 },
      new Date('2026-04-17T17:01:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.triggerKind).toBe('unread');
  });

  it('wakes when actionable cards exist and cooldown is clear', () => {
    const state = createInitialSessionState('gh-agent');
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 0, actionableCount: 2 },
      new Date('2026-04-17T17:01:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.triggerKind).toBe('actionable');
  });

  it('wakes when both signal types exist', () => {
    const state = createInitialSessionState('gh-agent');
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 2, actionableCount: 1 },
      new Date('2026-04-17T17:01:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.triggerKind).toBe('both');
  });

  it('does not wake when no signals exist', () => {
    const state = createInitialSessionState('gh-agent');
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 0, actionableCount: 0 },
      new Date('2026-04-17T17:01:00.000Z'),
    );

    expect(decision.shouldWake).toBe(false);
    expect(decision.triggerKind).toBe('none');
  });

  it('blocks wake during debounce window', () => {
    const state = {
      ...createInitialSessionState(
        'gh-agent',
        new Date('2026-04-17T17:00:00.000Z'),
      ),
      nextWakeNotBefore: '2026-04-17T17:10:00.000Z',
    };
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 1, actionableCount: 0 },
      new Date('2026-04-17T17:05:00.000Z'),
    );

    expect(decision.shouldWake).toBe(false);
    expect(decision.blockedByCooldown).toBe(true);
  });

  it('allows wake exactly at the cooldown boundary', () => {
    const state = {
      ...createInitialSessionState('gh-agent'),
      nextWakeNotBefore: '2026-04-17T17:10:00.000Z',
    };
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 1, actionableCount: 0 },
      new Date('2026-04-17T17:10:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.blockedByCooldown).toBe(false);
  });

  it('ignores invalid cooldown timestamps', () => {
    const state = {
      ...createInitialSessionState('gh-agent'),
      nextWakeNotBefore: 'not-a-date',
    };
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 1, actionableCount: 0 },
      new Date('2026-04-17T17:10:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.blockedByCooldown).toBe(false);
  });
});

describe('session state transitions', () => {
  it('starts a session in active mode and clears cooldown', () => {
    const sessionId = createSessionId(new Date('2026-04-17T17:00:00.000Z'));
    const state = startSession(
      {
        ...createInitialSessionState('gh-agent'),
        nextWakeNotBefore: '2026-04-17T17:10:00.000Z',
      },
      sessionId,
      new Date('2026-04-17T17:00:00.000Z'),
    );

    expect(state.currentMode).toBe('active');
    expect(state.currentSessionId).toBe(sessionId);
    expect(state.nextWakeNotBefore).toBeNull();
    expect(state.lastSessionStartedAt).toBe('2026-04-17T17:00:00.000Z');
  });

  it('finishes a session in sleeping mode with the debounce window applied', () => {
    const state = finishSession(
      {
        ...createInitialSessionState('gh-agent'),
        currentMode: 'active',
        currentSessionId: 'sess_1',
      },
      {
        agentId: 'gh-agent',
        pollIntervalMs: 30_000,
        debounceMs: 60_000,
        projectId: null,
        projectTitle: null,
        projectUrl: null,
        projectFieldIds: {
          status: null,
          priority: null,
          type: null,
          sourceLink: null,
          nextAction: null,
          shortNote: null,
        },
        projectStatusOptionIds: {
          ready: null,
          doing: null,
          waiting: null,
          done: null,
        },
      },
      new Date('2026-04-17T17:00:00.000Z'),
    );

    expect(state.currentMode).toBe('sleeping');
    expect(state.currentSessionId).toBeNull();
    expect(state.nextWakeNotBefore).toBe('2026-04-17T17:01:00.000Z');
    expect(state.lastSessionEndedAt).toBe('2026-04-17T17:00:00.000Z');
  });

  it('records the last notification poll timestamp', () => {
    const state = recordNotificationPoll(
      createInitialSessionState('gh-agent'),
      new Date('2026-04-17T17:02:00.000Z'),
    );

    expect(state.lastNotificationPollAt).toBe('2026-04-17T17:02:00.000Z');
  });
});
