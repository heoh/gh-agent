import { acquireLock, releaseLock } from '../core/lock.js';
import {
  createSessionId,
  evaluateWakeDecision,
  finishSession,
  getMockSignalSummary,
  startSession,
} from '../core/runtime.js';
import {
  appendWakeDecision,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  saveSessionState,
} from '../core/workspace.js';

export async function runCommand(): Promise<void> {
  const paths = getWorkspacePaths();

  await ensureWorkspaceStructure(paths);
  const config = await ensureConfig(paths);
  let state = await ensureSessionState(paths, config.agentId);

  await acquireLock(paths.lockFile, paths.root);

  try {
    console.log('Polling started');

    const now = new Date();
    const signals = getMockSignalSummary();

    const wakeDecision = evaluateWakeDecision(state, signals, now);

    await appendWakeDecision(paths, {
      evaluatedAt: now.toISOString(),
      unreadNotificationCount: signals.unreadCount,
      actionableCardCount: signals.actionableCount,
      shouldWake: wakeDecision.shouldWake,
      blockedByCooldown: wakeDecision.blockedByCooldown,
      reason: wakeDecision.reason,
      triggerKind: wakeDecision.triggerKind,
    });

    console.log(
      `Signals: unread=${signals.unreadCount} actionable=${signals.actionableCount} shouldWake=${wakeDecision.shouldWake}`,
    );

    if (wakeDecision.shouldWake) {
      const sessionStartAt = new Date();
      const sessionId = createSessionId(sessionStartAt);

      state = startSession(state, sessionId);
      await saveSessionState(paths, state);
      console.log(`Session started: ${sessionId}`);

      const sessionEndAt = new Date();
      state = finishSession(state, config, sessionEndAt);
      console.log('Session ended');
    }

    await saveSessionState(paths, state);
    console.log('Polling complete');
  } finally {
    await releaseLock(paths.lockFile);
  }
}
