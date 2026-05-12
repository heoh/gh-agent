import { describe, expect, it } from 'vitest';

import {
  createCommandGitHubClientStub,
  createCommandTestWorkspace,
  parseLastJsonLog,
} from '../test/command-fixtures.js';
import type {
  MailboxIgnoreResult,
  MailboxNotification,
  MailboxPromotionResult,
  MailboxShowResult,
} from '../core/types.js';
import {
  captureConsoleLogs,
  setupWorkspaceTest,
} from '../test/test-helpers.js';
import { mailboxIgnoreCommand } from './mailbox/ignore.js';
import { mailboxListCommand } from './mailbox/list.js';
import { mailboxReadyCommand, mailboxWaitCommand } from './mailbox/promote.js';
import { mailboxShowCommand } from './mailbox/show.js';

const { getWorkspaceRoot } = setupWorkspaceTest();

describe('mailbox commands', () => {
  describe('usage examples', () => {
    it('lists unread notification rows with thread ids for follow-up commands', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await mailboxListCommand(
        { limit: 2 },
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<MailboxNotification[]>(logs)).toEqual([
        {
          id: 'thread_1',
          repositoryFullName: 'acme/widgets',
          title: 'Review mailbox triage',
          reason: 'review_requested',
          type: 'PullRequest',
          updatedAt: '2026-04-20T10:00:00.000Z',
        },
        {
          id: 'thread_2',
          repositoryFullName: 'acme/docs',
          title: 'Triage docs cleanup',
          reason: 'mention',
          type: 'Issue',
          updatedAt: '2026-04-21T10:00:00.000Z',
        },
      ]);
    });

    it('shows a mailbox thread with its source URL and related project cards', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await mailboxShowCommand(
        'thread_1',
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      expect(parseLastJsonLog<MailboxShowResult>(logs)).toEqual({
        threadId: 'thread_1',
        repositoryFullName: 'acme/widgets',
        title: 'Review mailbox triage',
        reason: 'review_requested',
        type: 'PullRequest',
        unread: true,
        updatedAt: '2026-04-20T10:00:00.000Z',
        sourceUrl: 'https://github.com/acme/widgets/pull/7',
        relatedCards: [
          {
            id: 'item_related_1',
            projectId: 'proj_123',
            title: 'Review mailbox triage',
            sourceLink: 'https://github.com/acme/widgets/pull/7',
            status: 'ready',
          },
        ],
      });
    });

    it('marks selected threads ready or waiting and returns one result per thread', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await mailboxReadyCommand(
        ['thread_1'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );
      await mailboxWaitCommand(
        ['thread_2'],
        {},
        {
          githubClient: createCommandGitHubClientStub(),
        },
      );

      const outputs = logs
        .filter((line) => line.startsWith('['))
        .map((line) => JSON.parse(line) as MailboxPromotionResult[]);

      expect(outputs).toEqual([
        [
          {
            threadId: 'thread_1',
            status: 'ready',
            ok: true,
            card: {
              id: 'item_thread_1',
              projectId: 'proj_123',
              title: 'Review mailbox triage',
              sourceLink: 'https://github.com/acme/widgets/pull/7',
              status: 'ready',
            },
          },
        ],
        [
          {
            threadId: 'thread_2',
            status: 'waiting',
            ok: true,
            card: {
              id: 'item_thread_2',
              projectId: 'proj_123',
              title: 'Triage docs cleanup',
              sourceLink: 'https://github.com/acme/docs/issues/2',
              status: 'waiting',
            },
          },
        ],
      ]);
    });

    it('ignores selected threads by marking them read without creating cards', async () => {
      const logs = captureConsoleLogs();
      const markedAsRead: string[] = [];
      await createCommandTestWorkspace(getWorkspaceRoot());

      await mailboxIgnoreCommand(
        ['thread_1', 'thread_2'],
        {},
        {
          githubClient: createCommandGitHubClientStub({
            async markMailboxThreadAsRead(_paths, threadId) {
              markedAsRead.push(threadId);
            },
          }),
        },
      );

      expect(markedAsRead).toEqual(['thread_1', 'thread_2']);
      expect(parseLastJsonLog<MailboxIgnoreResult[]>(logs)).toEqual([
        {
          threadId: 'thread_1',
          ok: true,
          read: true,
        },
        {
          threadId: 'thread_2',
          ok: true,
          read: true,
        },
      ]);
    });
  });

  describe('behavior checks', () => {
    it('continues promoting later threads and fails after mixed promotion results', async () => {
      const logs = captureConsoleLogs();
      await createCommandTestWorkspace(getWorkspaceRoot());

      await expect(
        mailboxReadyCommand(
          ['thread_1', 'thread_2'],
          {},
          {
            githubClient: createCommandGitHubClientStub({
              async promoteMailboxThread(_paths, config, target, status) {
                if (target.threadId === 'thread_2') {
                  throw new Error('promotion failed for thread_2');
                }

                return {
                  id: `item_${target.threadId}`,
                  projectId: config.projectId as string,
                  title: target.title,
                  sourceLink: target.sourceUrl,
                  status,
                };
              },
            }),
          },
        ),
      ).rejects.toMatchObject({
        message: 'One or more mailbox thread promotions failed.',
        exitCode: 1,
      });

      expect(parseLastJsonLog<MailboxPromotionResult[]>(logs)).toEqual([
        {
          threadId: 'thread_1',
          status: 'ready',
          ok: true,
          card: {
            id: 'item_thread_1',
            projectId: 'proj_123',
            title: 'Review mailbox triage',
            sourceLink: 'https://github.com/acme/widgets/pull/7',
            status: 'ready',
          },
        },
        {
          threadId: 'thread_2',
          status: 'ready',
          ok: false,
          error: 'promotion failed for thread_2',
          errorCategory: 'runtime',
        },
      ]);
    });

    it('maps unauthenticated mailbox access to exit code 3', async () => {
      await createCommandTestWorkspace(getWorkspaceRoot());

      await expect(
        mailboxListCommand(
          {},
          {
            githubClient: createCommandGitHubClientStub({
              async getAuthStatus(paths) {
                return {
                  kind: 'unauthenticated',
                  detail: 'not logged in',
                  ghConfigDir: paths.ghConfigDir,
                };
              },
            }),
          },
        ),
      ).rejects.toMatchObject({
        message: 'GitHub authentication error: not logged in',
        exitCode: 3,
      });
    });
  });
});
