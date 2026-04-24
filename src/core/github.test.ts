import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { Config } from './types.js';

const execFileMock = vi.fn();
const spawnMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

const githubModule = await import('./github.js');

const {
  createGitHubSignalClient,
  parseMailboxNotificationsPayload,
  resolveMailboxThreadDetail,
  sortMailboxNotificationsOldestFirst,
} = githubModule;

function mockExecFileResponses(
  responses: Array<{ stdout?: string; stderr?: string; error?: Error }>,
): void {
  execFileMock.mockImplementation((_file, _args, _options, callback) => {
    const response = responses.shift();

    if (response === undefined) {
      callback(null, '', '');
      return;
    }

    callback(
      response.error ?? null,
      response.stdout ?? '',
      response.stderr ?? '',
    );
  });
}

function createConfig(): Config {
  return {
    agentId: 'gh-agent',
    pollIntervalMs: 30_000,
    debounceMs: 60_000,
    projectId: 'proj_123',
    projectTitle: 'gh-agent',
    projectUrl: 'https://github.com/users/test/projects/1',
    projectFieldIds: {
      status: 'field_status',
      priority: 'field_priority',
      type: 'field_type',
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
  };
}

describe('parseMailboxNotificationsPayload', () => {
  it('parses standard notification payloads', () => {
    const notifications = parseMailboxNotificationsPayload(
      JSON.stringify([
        [
          {
            id: 'thread_1',
            reason: 'review_requested',
            updated_at: '2026-04-20T10:00:00Z',
            repository: {
              full_name: 'acme/widgets',
            },
            subject: {
              title: 'Add mailbox list command',
              type: 'PullRequest',
            },
          },
        ],
      ]),
    );

    expect(notifications).toEqual([
      {
        id: 'thread_1',
        repositoryFullName: 'acme/widgets',
        title: 'Add mailbox list command',
        reason: 'review_requested',
        type: 'PullRequest',
        updatedAt: '2026-04-20T10:00:00.000Z',
      },
    ]);
  });

  it('falls back to owner/name and a null type when optional fields are missing', () => {
    const notifications = parseMailboxNotificationsPayload(
      JSON.stringify([
        {
          id: 'thread_2',
          reason: 'mention',
          updated_at: 'not-a-date',
          repository: {
            name: 'widgets',
            owner: {
              login: 'acme',
            },
          },
          subject: {
            title: 'Triaging notifications',
          },
        },
      ]),
    );

    expect(notifications).toEqual([
      {
        id: 'thread_2',
        repositoryFullName: 'acme/widgets',
        title: 'Triaging notifications',
        reason: 'mention',
        type: null,
        updatedAt: null,
      },
    ]);
  });

  it('skips malformed records and preserves list length for valid ones', () => {
    const notifications = parseMailboxNotificationsPayload(
      JSON.stringify([
        [
          {
            id: 'thread_1',
            reason: 'assign',
            updated_at: '2026-04-19T09:00:00Z',
            repository: {
              full_name: 'acme/widgets',
            },
            subject: {
              title: 'Valid notification',
              type: 'Issue',
            },
          },
          {
            id: 'thread_ignored',
            repository: {
              full_name: 'acme/widgets',
            },
            subject: {
              title: 'Missing reason',
              type: 'Issue',
            },
          },
        ],
      ]),
    );

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.id).toBe('thread_1');
  });

  it('sorts notifications oldest unread first before applying top-N limits', () => {
    const notifications = sortMailboxNotificationsOldestFirst([
      {
        id: 'thread_3',
        repositoryFullName: 'acme/widgets',
        title: 'Newest',
        reason: 'mention',
        type: 'Issue',
        updatedAt: '2026-04-22T09:00:00.000Z',
      },
      {
        id: 'thread_1',
        repositoryFullName: 'acme/widgets',
        title: 'Oldest',
        reason: 'assign',
        type: 'Issue',
        updatedAt: '2026-04-20T09:00:00.000Z',
      },
      {
        id: 'thread_2',
        repositoryFullName: 'acme/widgets',
        title: 'Unknown timestamp',
        reason: 'author',
        type: 'PullRequest',
        updatedAt: null,
      },
    ]);

    expect(notifications.map((notification) => notification.id)).toEqual([
      'thread_1',
      'thread_3',
      'thread_2',
    ]);
  });
});

describe('GitHub mailbox mutations', () => {
  beforeEach(() => {
    execFileMock.mockReset();
    spawnMock.mockReset();
  });

  it('resolveMailboxThreadDetail loads the canonical thread URL and content node id', async () => {
    mockExecFileResponses([
      {
        stdout: JSON.stringify({
          id: 'thread_1',
          repository: { full_name: 'acme/widgets' },
          subject: {
            title: 'Add mailbox list command',
            type: 'PullRequest',
            url: 'https://api.github.com/repos/acme/widgets/pulls/1',
          },
        }),
      },
      {
        stdout: JSON.stringify({
          html_url: 'https://github.com/acme/widgets/pull/1',
          node_id: 'node_pull_1',
        }),
      },
    ]);

    const detail = await resolveMailboxThreadDetail(
      { ghConfigDir: '/tmp/gh-config' },
      'thread_1',
    );

    expect(detail).toEqual({
      id: 'thread_1',
      repositoryFullName: 'acme/widgets',
      subject: {
        title: 'Add mailbox list command',
        type: 'PullRequest',
        url: 'https://github.com/acme/widgets/pull/1',
      },
      contentNodeId: 'node_pull_1',
    });
    expect(execFileMock).toHaveBeenNthCalledWith(
      1,
      'gh',
      ['api', 'notifications/threads/thread_1'],
      expect.any(Object),
      expect.any(Function),
    );
    expect(execFileMock).toHaveBeenNthCalledWith(
      2,
      'gh',
      ['api', '/repos/acme/widgets/pulls/1'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('promoteMailboxThread adds a project item from content and sets status and source link', async () => {
    mockExecFileResponses([
      {
        stdout: JSON.stringify({
          data: {
            addProjectV2ItemById: {
              item: { id: 'item_123' },
            },
          },
        }),
      },
      {
        stdout: JSON.stringify({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item_123' },
            },
          },
        }),
      },
      {
        stdout: JSON.stringify({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item_123' },
            },
          },
        }),
      },
    ]);

    const client = createGitHubSignalClient();
    const card = await client.promoteMailboxThread(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      {
        threadId: 'thread_1',
        title: 'Add mailbox list command',
        repositoryFullName: 'acme/widgets',
        sourceUrl: 'https://github.com/acme/widgets/pull/1',
        contentNodeId: 'node_pull_1',
      },
      'ready',
    );

    expect(card).toEqual({
      id: 'item_123',
      projectId: 'proj_123',
      title: 'Add mailbox list command',
      sourceLink: 'https://github.com/acme/widgets/pull/1',
      status: 'ready',
    });

    const graphqlCalls = execFileMock.mock.calls.map((call) => call[1]);
    expect(graphqlCalls[0]).toContain('graphql');
    expect(graphqlCalls[0].join(' ')).toContain('addProjectV2ItemById');
    expect(graphqlCalls[0]).toContain('-F');
    expect(graphqlCalls[0].join(' ')).toContain('contentId=node_pull_1');
    expect(graphqlCalls[1].join(' ')).toContain('singleSelectOptionId');
    expect(graphqlCalls[1].join(' ')).toContain('optionId=status_ready');
    expect(graphqlCalls[2].join(' ')).toContain('value: { text: $value }');
    expect(graphqlCalls[2].join(' ')).toContain(
      'value=https://github.com/acme/widgets/pull/1',
    );
  });

  it('promoteMailboxThread falls back to a draft project item when no content node id exists', async () => {
    mockExecFileResponses([
      {
        stdout: JSON.stringify({
          data: {
            addProjectV2DraftIssue: {
              projectItem: { id: 'item_draft_1' },
            },
          },
        }),
      },
      {
        stdout: JSON.stringify({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item_draft_1' },
            },
          },
        }),
      },
      {
        stdout: JSON.stringify({
          data: {
            updateProjectV2ItemFieldValue: {
              projectV2Item: { id: 'item_draft_1' },
            },
          },
        }),
      },
    ]);

    const client = createGitHubSignalClient();
    const card = await client.promoteMailboxThread(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      {
        threadId: 'thread_2',
        title: 'Triage docs cleanup',
        repositoryFullName: 'acme/docs',
        sourceUrl: 'https://github.com/acme/docs/issues/2',
        contentNodeId: null,
      },
      'waiting',
    );

    expect(card.id).toBe('item_draft_1');
    expect(execFileMock.mock.calls[0]?.[1].join(' ')).toContain(
      'addProjectV2DraftIssue',
    );
  });

  it('markMailboxThreadAsRead sends the notifications PATCH request', async () => {
    mockExecFileResponses([{ stdout: '' }]);

    const client = createGitHubSignalClient();
    await client.markMailboxThreadAsRead(
      { ghConfigDir: '/tmp/gh-config' },
      'thread_1',
    );

    expect(execFileMock).toHaveBeenCalledWith(
      'gh',
      ['api', '--method', 'PATCH', 'notifications/threads/thread_1'],
      expect.any(Object),
      expect.any(Function),
    );
  });
});
