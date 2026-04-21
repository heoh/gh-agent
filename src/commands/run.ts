import { acquireLock, releaseLock } from '../core/lock.js';
import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../core/github.js';
import {
  createSessionId,
  evaluateWakeDecision,
  finishSession,
  recordNotificationPoll,
  startSession,
} from '../core/runtime.js';
import type { GitHubSignalClient } from '../core/types.js';
import {
  appendWakeDecision,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  saveSessionState,
} from '../core/workspace.js';

export async function runCommand(
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const paths = getWorkspacePaths();
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  await ensureWorkspaceStructure(paths);
  const config = await ensureConfig(paths);
  let state = await ensureSessionState(paths, config.agentId);

  try {
    await acquireLock(paths.lockFile, paths.root);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('gh-agent is already running with pid ')
    ) {
      throw Object.assign(error, { exitCode: 4 });
    }

    throw error;
  }

  try {
    console.log('Polling started');

    const now = new Date();
    const previousAgentMode = state.currentMode;
    const signals = await githubClient.getSignalSummary(paths, config);
    state = recordNotificationPoll(state, now);
    await saveSessionState(paths, state);

    const wakeDecision = evaluateWakeDecision(state, signals, now);
    let createdSessionId: string | null = null;

    console.log(
      `Signals: unread=${signals.unreadCount} actionable=${signals.actionableCount} shouldWake=${wakeDecision.shouldWake}`,
    );

    if (wakeDecision.shouldWake) {
      const sessionStartAt = new Date();
      const sessionId = createSessionId(sessionStartAt);

      state = startSession(state, sessionId, sessionStartAt);
      await saveSessionState(paths, state);
      console.log(`Session started: ${sessionId}`);
      createdSessionId = sessionId;

      const sessionEndAt = new Date();
      state = finishSession(state, config, sessionEndAt);
      console.log('Session ended');
    }

    await saveSessionState(paths, state);
    await appendWakeDecision(paths, {
      evaluatedAt: now.toISOString(),
      previousAgentMode,
      unreadNotificationCount: signals.unreadCount,
      actionableCardCount: signals.actionableCount,
      shouldWake: wakeDecision.shouldWake,
      blockedByCooldown: wakeDecision.blockedByCooldown,
      reason: wakeDecision.reason,
      triggerKind: wakeDecision.triggerKind,
      createdSessionId,
    });
    console.log('Polling complete');
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      throw Object.assign(
        new Error(`GitHub authentication error: ${error.message}`),
        { exitCode: 3 },
      );
    }

    if (error instanceof GitHubConfigError) {
      throw Object.assign(new Error(error.message), { exitCode: 2 });
    }

    throw error;
  } finally {
    await releaseLock(paths.lockFile);
  }
}
