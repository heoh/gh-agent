import { describe, expect, it } from 'vitest';

import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { statusCommand } from './commands/status.js';
import { createInitialSessionState } from './core/workspace.js';
import { evaluateWakeDecision } from './core/runtime.js';

describe('command stubs', () => {
  it('exposes init, run, and status command handlers', () => {
    expect(initCommand).toBeTypeOf('function');
    expect(runCommand).toBeTypeOf('function');
    expect(statusCommand).toBeTypeOf('function');
  });
});

describe('wake decision', () => {
  it('wakes when unread notifications exist and cooldown is clear', () => {
    const state = createInitialSessionState('gh-agent', new Date('2026-04-17T17:00:00.000Z'));
    const decision = evaluateWakeDecision(
      state,
      { unreadCount: 1, actionableCount: 0 },
      new Date('2026-04-17T17:01:00.000Z'),
    );

    expect(decision.shouldWake).toBe(true);
    expect(decision.triggerKind).toBe('unread');
  });

  it('blocks wake during debounce window', () => {
    const state = {
      ...createInitialSessionState('gh-agent', new Date('2026-04-17T17:00:00.000Z')),
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
});
