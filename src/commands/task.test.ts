import { describe, expect, it } from 'vitest';

import {
  createCommandGitHubClientStub,
  createCommandTestWorkspace,
  createTaskCardFixture,
  parseLastJsonLog,
} from '../test/command-fixtures.js';
import type {
  TaskCard,
  TaskListItem,
  TaskStatusUpdateResult,
} from '../core/types.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { taskCreateCommand } from './task/create.js';
import { taskListCommand } from './task/list.js';
import { taskShowCommand } from './task/show.js';
import {
  taskDoingCommand,
  taskDoneCommand,
  taskReadyCommand,
  taskWaitCommand,
} from './task/status.js';
import { taskUpdateCommand } from './task/update.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('task commands', () => {
  describe('usage examples', () => {
    it('lists task rows with the fields agents need for triage decisions', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await taskListCommand(
        {
          statuses: ['ready', 'waiting'],
        },
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<TaskListItem[]>(logs)).toEqual([
        {
          id: 'item_1',
          title: 'Fix mailbox sync',
          updatedAt: '2026-04-20T10:00:00.000Z',
          status: 'ready',
          priority: 'P1',
          type: 'execution',
          executionClass: 'light',
          sourceLink: 'https://github.com/acme/widgets/issues/7',
          nextAction: 'Open a narrow implementation PR',
          shortNote: 'Ready for implementation',
        },
        {
          id: 'item_2',
          title: 'Reply to docs question',
          updatedAt: '2026-04-21T10:00:00.000Z',
          status: 'waiting',
          priority: 'P3',
          type: 'interaction',
          executionClass: 'heavy',
          sourceLink: 'https://github.com/acme/docs/issues/2',
          nextAction: 'Wait for owner clarification',
          shortNote: 'Owner question needs a response',
        },
      ]);
    });

    it('shows one task card with project metadata and durable next action text', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await taskShowCommand(
        'item_1',
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<TaskCard>(logs)).toEqual({
        id: 'item_1',
        projectId: 'proj_123',
        title: 'Fix mailbox sync',
        updatedAt: '2026-04-20T10:00:00.000Z',
        status: 'ready',
        priority: 'P1',
        type: 'execution',
        executionClass: 'light',
        sourceLink: 'https://github.com/acme/widgets/issues/7',
        nextAction: 'Open a narrow implementation PR',
        shortNote: 'Ready for implementation',
      });
    });

    it('creates a task from explicit title, status, source link, and review notes', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await taskCreateCommand(
        {
          title: 'Document mailbox usage',
          status: 'ready',
          priority: 'P2',
          type: 'execution',
          executionClass: 'light',
          sourceLink: 'https://github.com/acme/widgets/issues/9',
          nextAction: 'Add usage examples for mailbox commands',
          shortNote: 'Created from command usage test',
        },
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<TaskCard>(logs)).toEqual({
        id: 'item_created',
        projectId: 'proj_123',
        title: 'Document mailbox usage',
        updatedAt: null,
        status: 'ready',
        priority: 'P2',
        type: 'execution',
        executionClass: 'light',
        sourceLink: 'https://github.com/acme/widgets/issues/9',
        nextAction: 'Add usage examples for mailbox commands',
        shortNote: 'Created from command usage test',
      });
    });

    it('updates only the supplied task fields and keeps the rest unchanged', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await taskUpdateCommand(
        'item_1',
        {
          status: 'doing',
          nextAction: 'Push a focused PR for review',
        },
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<TaskCard>(logs)).toEqual({
        id: 'item_1',
        projectId: 'proj_123',
        title: 'Fix mailbox sync',
        updatedAt: '2026-04-20T10:00:00.000Z',
        status: 'doing',
        priority: 'P1',
        type: 'execution',
        executionClass: 'light',
        sourceLink: 'https://github.com/acme/widgets/issues/7',
        nextAction: 'Push a focused PR for review',
        shortNote: 'Ready for implementation',
      });
    });

    it('moves selected tasks through the ready, doing, waiting, and done aliases', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await taskReadyCommand(
        ['item_1'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );
      await taskDoingCommand(
        ['item_1'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );
      await taskWaitCommand(
        ['item_1'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );
      await taskDoneCommand(
        ['item_1'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      const statuses = logs
        .filter((line) => line.startsWith('['))
        .flatMap((line) =>
          (JSON.parse(line) as TaskStatusUpdateResult[]).map(
            (result) => result.status,
          ),
        );

      expect(statuses).toEqual(['ready', 'doing', 'waiting', 'done']);
    });
  });

  describe('behavior checks', () => {
    it('continues updating later tasks and fails after mixed status results', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await expect(
        taskDoneCommand(
          ['item_1', 'item_2'],
          {},
          {
            githubClient: createCommandGitHubClientStub({
              async setTaskCardStatus(_paths, _config, taskId, status) {
                if (taskId === 'item_2') {
                  throw new Error('status update failed for item_2');
                }

                return {
                  ...createTaskCardFixture(taskId),
                  status,
                };
              },
            }),
          },
        ),
      ).rejects.toMatchObject({
        message: 'One or more task status updates failed.',
        exitCode: 1,
      });

      expect(parseLastJsonLog<TaskStatusUpdateResult[]>(logs)).toEqual([
        {
          taskId: 'item_1',
          status: 'done',
          ok: true,
          task: {
            id: 'item_1',
            title: 'Fix mailbox sync',
            updatedAt: '2026-04-20T10:00:00.000Z',
            status: 'done',
            priority: 'P1',
            type: 'execution',
            executionClass: 'light',
            sourceLink: 'https://github.com/acme/widgets/issues/7',
            nextAction: 'Open a narrow implementation PR',
            shortNote: 'Ready for implementation',
          },
        },
        {
          taskId: 'item_2',
          status: 'done',
          ok: false,
          error: 'status update failed for item_2',
          errorCategory: 'runtime',
        },
      ]);
    });

    it('rejects task creation without the required status option', async () => {
      await expect(
        taskCreateCommand({
          title: 'Missing status example',
        }),
      ).rejects.toMatchObject({
        message: 'The --status option is required.',
        exitCode: 1,
      });
    });
  });
});
