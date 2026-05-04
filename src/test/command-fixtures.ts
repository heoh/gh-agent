import { writeFile } from 'node:fs/promises';

import { expect } from 'vitest';

import type {
  Config,
  GitHubSignalClient,
  MailboxNotification,
  MailboxThreadDetail,
  TaskCard,
  TaskListFilters,
  TaskListItem,
} from '../core/types.js';
import {
  createInitialSessionState,
  DEFAULT_CONFIG,
  ensureWorkspaceStructure,
  getWorkspacePaths,
  saveConfig,
  saveSessionState,
} from '../core/workspace.js';

export const PROJECT_ID = 'proj_123';

export function createCommandTestConfig(): Config {
  return {
    ...DEFAULT_CONFIG,
    agentId: 'gh-agent',
    projectId: PROJECT_ID,
    projectTitle: 'gh-agent',
    projectUrl: 'https://github.com/users/test/projects/1',
  };
}

export async function createCommandTestWorkspace(root: string): Promise<void> {
  const paths = getWorkspacePaths(root);
  const config = createCommandTestConfig();

  await ensureWorkspaceStructure(paths);
  await saveConfig(paths, config);
  await saveSessionState(paths, {
    ...createInitialSessionState(config.agentId),
    lastNotificationPollAt: '2026-04-21T10:00:00.000Z',
  });
  await writeFile(paths.agentsFile, '# AGENTS.md\n', 'utf8');
}

export function createMailboxNotificationFixture(
  id: string,
): MailboxNotification {
  return {
    id,
    repositoryFullName: id === 'thread_2' ? 'acme/docs' : 'acme/widgets',
    title: id === 'thread_2' ? 'Triage docs cleanup' : 'Review mailbox triage',
    reason: id === 'thread_2' ? 'mention' : 'review_requested',
    type: id === 'thread_2' ? 'Issue' : 'PullRequest',
    updatedAt:
      id === 'thread_2'
        ? '2026-04-21T10:00:00.000Z'
        : '2026-04-20T10:00:00.000Z',
  };
}

export function createMailboxThreadFixture(
  threadId: string,
): MailboxThreadDetail {
  const notification = createMailboxNotificationFixture(threadId);
  const sourceUrl =
    threadId === 'thread_2'
      ? 'https://github.com/acme/docs/issues/2'
      : 'https://github.com/acme/widgets/pull/7';

  return {
    id: threadId,
    repositoryFullName: notification.repositoryFullName,
    reason: notification.reason,
    isUnread: threadId !== 'thread_read',
    updatedAt: notification.updatedAt,
    subject: {
      title: notification.title,
      type: notification.type,
      url: sourceUrl,
    },
  };
}

export function createTaskCardFixture(taskId: string): TaskCard {
  return {
    id: taskId,
    projectId: PROJECT_ID,
    title: taskId === 'item_2' ? 'Reply to docs question' : 'Fix mailbox sync',
    updatedAt:
      taskId === 'item_2'
        ? '2026-04-21T10:00:00.000Z'
        : '2026-04-20T10:00:00.000Z',
    status: taskId === 'item_2' ? 'waiting' : 'ready',
    priority: taskId === 'item_2' ? 'P3' : 'P1',
    type: taskId === 'item_2' ? 'interaction' : 'execution',
    executionClass: taskId === 'item_2' ? 'heavy' : 'light',
    sourceLink:
      taskId === 'item_2'
        ? 'https://github.com/acme/docs/issues/2'
        : 'https://github.com/acme/widgets/issues/7',
    nextAction:
      taskId === 'item_2'
        ? 'Wait for owner clarification'
        : 'Open a narrow implementation PR',
    shortNote:
      taskId === 'item_2'
        ? 'Owner question needs a response'
        : 'Ready for implementation',
  };
}

function toTaskListItem(task: TaskCard): TaskListItem {
  const { projectId, ...listItem } = task;
  void projectId;

  return listItem;
}

export function createCommandGitHubClientStub(
  overrides: Partial<GitHubSignalClient> = {},
): GitHubSignalClient {
  return {
    async login() {
      return;
    },
    async refreshProjectScopes() {
      return;
    },
    async ensureProject() {
      return {
        wasCreated: false,
        projectId: PROJECT_ID,
        projectTitle: 'gh-agent',
        projectUrl: 'https://github.com/users/test/projects/1',
        projectFieldIds: {
          status: 'field_status',
          priority: 'field_priority',
          type: 'field_type',
          executionClass: 'field_execution_class',
          sourceLink: 'field_source_link',
          nextAction: 'field_next_action',
          shortNote: 'field_short_note',
        },
        projectStatusOptionIds: {
          ready: 'status_ready',
          doing: 'status_doing',
          waiting: 'status_waiting',
          done: 'status_done',
        },
        projectExecutionClassOptionIds: {
          light: 'execution_class_light',
          heavy: 'execution_class_heavy',
        },
      };
    },
    async getSignalSummary(_paths, config) {
      expect(config.projectId).toBe(PROJECT_ID);
      return {
        unreadCount: 2,
        actionableCount: 1,
      };
    },
    async listMailboxNotifications(_paths, options) {
      return ['thread_1', 'thread_2']
        .map(createMailboxNotificationFixture)
        .slice(0, options?.limit ?? 2);
    },
    async getMailboxThreadDetail(_paths, threadId) {
      if (threadId === 'missing_thread') {
        throw new Error('Mailbox thread "missing_thread" was not found.');
      }

      return createMailboxThreadFixture(threadId);
    },
    async promoteMailboxThread(_paths, config, target, status) {
      expect(config.projectId).toBe(PROJECT_ID);

      return {
        id: `item_${target.threadId}`,
        projectId: PROJECT_ID,
        title: target.title,
        sourceLink: target.sourceUrl,
        status,
      };
    },
    async markMailboxThreadAsRead() {
      return;
    },
    async listRelatedMailboxCards(_paths, config, sourceUrl) {
      expect(config.projectId).toBe(PROJECT_ID);

      if (!sourceUrl.endsWith('/pull/7')) {
        return [];
      }

      return [
        {
          id: 'item_related_1',
          projectId: PROJECT_ID,
          title: 'Review mailbox triage',
          sourceLink: sourceUrl,
          status: 'ready',
        },
      ];
    },
    async listTaskCards(_paths, config, filters: TaskListFilters = {}) {
      expect(config.projectId).toBe(PROJECT_ID);

      return ['item_1', 'item_2']
        .map(createTaskCardFixture)
        .filter((task) => {
          if (
            filters.statuses !== undefined &&
            !filters.statuses.includes(task.status)
          ) {
            return false;
          }

          if (
            filters.priority !== undefined &&
            task.priority !== filters.priority
          ) {
            return false;
          }

          if (filters.type !== undefined && task.type !== filters.type) {
            return false;
          }

          if (
            filters.executionClass !== undefined &&
            task.executionClass !== filters.executionClass
          ) {
            return false;
          }

          return true;
        })
        .map(toTaskListItem);
    },
    async getTaskCard(_paths, config, taskId) {
      expect(config.projectId).toBe(PROJECT_ID);

      if (taskId === 'missing_item') {
        throw new Error(
          'GitHub Project item "missing_item" was not found in the configured project.',
        );
      }

      return createTaskCardFixture(taskId);
    },
    async createTaskCard(_paths, config, input) {
      expect(config.projectId).toBe(PROJECT_ID);

      return {
        id: 'item_created',
        projectId: PROJECT_ID,
        title: input.title,
        updatedAt: null,
        status: input.status,
        priority: input.priority ?? null,
        type: input.type ?? null,
        executionClass: input.executionClass ?? null,
        sourceLink: input.sourceLink ?? null,
        nextAction: input.nextAction ?? null,
        shortNote: input.shortNote ?? null,
      };
    },
    async updateTaskCard(_paths, config, taskId, input) {
      expect(config.projectId).toBe(PROJECT_ID);

      return {
        ...createTaskCardFixture(taskId),
        ...Object.fromEntries(
          Object.entries(input).filter(([, value]) => value !== undefined),
        ),
      };
    },
    async setTaskCardStatus(_paths, config, taskId, status) {
      expect(config.projectId).toBe(PROJECT_ID);

      return {
        ...createTaskCardFixture(taskId),
        status,
      };
    },
    async getAuthStatus(paths) {
      return {
        kind: 'authenticated',
        detail: 'stubbed auth status',
        ghConfigDir: paths.ghConfigDir,
      };
    },
    async getGitIdentity() {
      return {
        login: 'test-user',
        name: 'Test User',
        email: '123+test-user@users.noreply.github.com',
      };
    },
    ...overrides,
  };
}

export function parseLastJsonLog<T>(logs: string[]): T {
  return JSON.parse(logs.at(-1) ?? 'null') as T;
}
