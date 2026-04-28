import { spawn } from 'node:child_process';

import { acquireLock, releaseLock } from '../core/lock.js';
import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../core/github.js';
import {
  createSessionId,
  buildRichSessionPrompt,
  evaluateWakeDecision,
  finishSession,
  recordNotificationPoll,
  resolveAgentExecution,
  selectAgentClass,
  PROMPT_MAILBOX_SAMPLE_LIMIT,
  PROMPT_RECENT_TASK_CARD_LIMIT,
  PROMPT_TASK_SAMPLE_LIMIT,
  startSession,
} from '../core/runtime.js';
import type { GitHubSignalClient } from '../core/types.js';
import {
  appendWakeDecision,
  ensureConfig,
  ensureSessionState,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  saveSessionState,
  WorkspaceNotFoundError,
} from '../core/workspace.js';

async function defaultExecuteAgentSession(input: {
  command: string;
  prompt: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
}): Promise<number | null> {
  return await new Promise<number | null>((resolve, reject) => {
    const child = spawn(input.command, {
      cwd: input.cwd,
      env: input.env,
      shell: true,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('close', (code) => {
      resolve(code);
    });
  });
}

function createSessionEnvironment(input: {
  prompt: string;
  ghAgentHome: string;
  ghConfigDir: string;
  gitConfigGlobalFile: string;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GH_AGENT_PROMPT: input.prompt,
    GH_AGENT_HOME: input.ghAgentHome,
    GH_CONFIG_DIR: input.ghConfigDir,
    GIT_CONFIG_GLOBAL: input.gitConfigGlobalFile,
  };
}

function normalizePromptSampleLimit(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== 'string') {
    return null;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

function selectRecentUpdatedTaskCards(
  tasks: Array<{
    id: string;
    updatedAt?: string | null;
    status: string;
    executionClass: string | null;
    title: string;
    sourceLink: string | null;
    nextAction?: string | null;
    shortNote?: string | null;
  }>,
  limit: number,
): Array<{
  id: string;
  updatedAt: string | null;
  status: string;
  executionClass: string | null;
  title: string;
  sourceLink: string | null;
  nextAction: string | null;
  shortNote: string | null;
}> {
  return [...tasks]
    .sort((left, right) => {
      const leftDate = parseIsoDate(left.updatedAt);
      const rightDate = parseIsoDate(right.updatedAt);

      if (leftDate !== null && rightDate !== null) {
        const timeDiff = rightDate.getTime() - leftDate.getTime();

        if (timeDiff !== 0) {
          return timeDiff;
        }
      } else if (leftDate !== null) {
        return -1;
      } else if (rightDate !== null) {
        return 1;
      }

      const titleDiff = left.title.localeCompare(right.title);
      if (titleDiff !== 0) {
        return titleDiff;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, limit)
    .map((task) => ({
      id: task.id,
      updatedAt: task.updatedAt ?? null,
      status: task.status,
      executionClass: task.executionClass,
      title: task.title,
      sourceLink: task.sourceLink,
      nextAction: task.nextAction ?? null,
      shortNote: task.shortNote ?? null,
    }));
}

export async function runCommand(
  options: {
    cwd?: string;
  } = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
    maxPollCycles?: number;
    executeAgentSession?: (input: {
      command: string;
      prompt: string;
      cwd: string;
      env: NodeJS.ProcessEnv;
    }) => Promise<number | null>;
  } = {},
): Promise<void> {
  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);
    const githubClient =
      dependencies.githubClient ?? createGitHubSignalClient();
    const executeAgentSession =
      dependencies.executeAgentSession ?? defaultExecuteAgentSession;

    await ensureWorkspaceStructure(paths);
    const config = await ensureConfig(paths);
    let state = await ensureSessionState(paths, config.agentId);
    let shouldStop = false;
    let hasLoggedStop = false;
    let completedPollCycles = 0;
    const maxPollCycles = dependencies.maxPollCycles;
    let interruptPollSleep: (() => void) | null = null;
    let githubUsername: string | null = null;
    let githubName: string | null = null;

    const stopHandler = () => {
      if (!hasLoggedStop) {
        console.log('Stopping...');
        hasLoggedStop = true;
      }
      shouldStop = true;
      if (interruptPollSleep !== null) {
        interruptPollSleep();
        interruptPollSleep = null;
      }
    };

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
      process.on('SIGINT', stopHandler);
      process.on('SIGTERM', stopHandler);

      while (!shouldStop) {
        const now = new Date();
        const previousAgentMode = state.currentMode;
        const signals = await githubClient.getSignalSummary(paths, config);
        state = recordNotificationPoll(state, now);
        await saveSessionState(paths, state);

        const wakeDecision = evaluateWakeDecision(state, signals, now);
        let createdSessionId: string | null = null;
        let selectedAgentClass: 'default' | 'heavy' | null = null;
        let executedAgentClass: 'default' | 'heavy' | null = null;
        let agentCommand: string | null = null;
        let sessionExitCode: number | null = null;

        console.log(
          `Signals: unread=${signals.unreadCount} actionable=${signals.actionableCount} shouldWake=${wakeDecision.shouldWake}`,
        );

        if (wakeDecision.shouldWake) {
          const mailboxForSelection =
            await githubClient.listMailboxNotifications(paths, {
              limit: 1,
            });
          const actionableTasks = await githubClient.listTaskCards(
            paths,
            config,
            {
              statuses: ['ready', 'doing'],
            },
          );
          selectedAgentClass = selectAgentClass(
            mailboxForSelection.length,
            actionableTasks,
          );
          const execution = resolveAgentExecution(config, selectedAgentClass);
          executedAgentClass = execution.executedAgentClass;
          agentCommand = execution.command;

          console.log(`Selected agent: ${selectedAgentClass}`);
          console.log(`Executing agent command class: ${executedAgentClass}`);

          const sessionStartAt = new Date();
          const sessionId = createSessionId(sessionStartAt);
          const mailboxSampleLimit = normalizePromptSampleLimit(
            config.promptMailboxSampleLimit,
            PROMPT_MAILBOX_SAMPLE_LIMIT,
          );
          const taskSampleLimit = normalizePromptSampleLimit(
            config.promptTaskSampleLimit,
            PROMPT_TASK_SAMPLE_LIMIT,
          );
          const recentTaskCardLimit = normalizePromptSampleLimit(
            config.promptRecentTaskCardLimit,
            PROMPT_RECENT_TASK_CARD_LIMIT,
          );
          const mailboxSamples = await githubClient.listMailboxNotifications(
            paths,
            { limit: mailboxSampleLimit },
          );
          const allTaskCards = await githubClient.listTaskCards(
            paths,
            config,
            {},
          );
          const recentUpdatedTaskCards = selectRecentUpdatedTaskCards(
            allTaskCards,
            recentTaskCardLimit,
          );
          if (githubUsername === null || githubName === null) {
            const gitIdentity = await githubClient.getGitIdentity(paths);
            githubUsername = gitIdentity.login;
            githubName = gitIdentity.name;
          }

          const prompt = buildRichSessionPrompt({
            githubUsername: githubUsername,
            githubName,
            sessionId,
            wakeReason: wakeDecision.reason,
            triggerKind: wakeDecision.triggerKind,
            selectedAgentClass,
            executedAgentClass,
            unreadCount: signals.unreadCount,
            actionableCount: signals.actionableCount,
            mailboxSamples: mailboxSamples.map((sample) => ({
              id: sample.id,
              repositoryFullName: sample.repositoryFullName,
              title: sample.title,
              reason: sample.reason,
            })),
            actionableTaskSamples: actionableTasks
              .slice(0, taskSampleLimit)
              .map((task) => ({
                id: task.id,
                status: task.status,
                executionClass: task.executionClass,
                title: task.title,
                sourceLink: task.sourceLink,
                nextAction: task.nextAction ?? null,
                shortNote: task.shortNote ?? null,
              })),
            recentUpdatedTaskCards,
            mailboxSampleLimit,
            taskSampleLimit,
            recentTaskCardLimit,
          });

          state = startSession(state, sessionId, sessionStartAt);
          await saveSessionState(paths, state);
          console.log(`Session started: ${sessionId}`);
          createdSessionId = sessionId;

          try {
            sessionExitCode = await executeAgentSession({
              command: execution.command,
              prompt,
              cwd: paths.root,
              env: createSessionEnvironment({
                prompt,
                ghAgentHome: paths.root,
                ghConfigDir: paths.ghConfigDir,
                gitConfigGlobalFile: paths.gitConfigGlobalFile,
              }),
            });
            console.log(
              `Session command exited with code ${sessionExitCode ?? 'null'}`,
            );
          } catch (error) {
            const message =
              error instanceof Error ? error.message : String(error);
            console.log(`Session command failed: ${message}`);
            sessionExitCode = null;
          } finally {
            const sessionEndAt = new Date();
            state = finishSession(state, config, sessionEndAt);
            await saveSessionState(paths, state);
            console.log('Session ended');
          }
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
          selectedAgentClass,
          executedAgentClass,
          agentCommand,
          sessionExitCode,
        });

        completedPollCycles += 1;
        if (
          typeof maxPollCycles === 'number' &&
          completedPollCycles >= maxPollCycles
        ) {
          break;
        }

        if (shouldStop) {
          break;
        }

        await new Promise<void>((resolve) => {
          const timer = setTimeout(() => {
            interruptPollSleep = null;
            resolve();
          }, config.pollIntervalMs);

          interruptPollSleep = () => {
            clearTimeout(timer);
            resolve();
          };
        });
      }
    } finally {
      process.off('SIGINT', stopHandler);
      process.off('SIGTERM', stopHandler);
      await releaseLock(paths.lockFile);
    }
  } catch (error) {
    if (error instanceof WorkspaceNotFoundError) {
      throw Object.assign(
        new Error(
          'No gh-agent workspace found in the current directory or its parent directories.',
        ),
        { exitCode: 2 },
      );
    }

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
  }
}
