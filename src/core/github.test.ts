import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Config } from './types.js';

const execFileMock = vi.fn();
const spawnMock = vi.fn();
const octokitRequestMock = vi.fn();
const octokitGraphqlMock = vi.fn();
const octokitPaginateMock = vi.fn();
const octokitConstructorMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}));

vi.mock('octokit', () => ({
  Octokit: vi.fn().mockImplementation((options: { auth: string }) => {
    octokitConstructorMock(options);

    return {
      request: octokitRequestMock,
      graphql: octokitGraphqlMock,
      paginate: octokitPaginateMock,
    };
  }),
}));

const githubModule = await import('./github.js');

const {
  createGitHubSignalClient,
  parseMailboxNotificationsPayload,
  resolveMailboxThreadDetail,
  sortMailboxNotificationsOldestFirst,
} = githubModule;

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
}

function createProjectNode(items: unknown[]): { data: { node: unknown } } {
  return {
    data: {
      node: {
        id: 'proj_123',
        title: 'gh-agent',
        url: 'https://github.com/users/test/projects/1',
        fields: {
          nodes: [
            {
              id: 'field_status',
              name: 'Status',
              dataType: 'SINGLE_SELECT',
              options: [
                { id: 'status_ready', name: 'Ready' },
                { id: 'status_doing', name: 'Doing' },
                { id: 'status_waiting', name: 'Waiting' },
                { id: 'status_done', name: 'Done' },
              ],
            },
            { id: 'field_priority', name: 'Priority', dataType: 'TEXT' },
            { id: 'field_type', name: 'Type', dataType: 'TEXT' },
            {
              id: 'field_execution_class',
              name: 'Execution Class',
              dataType: 'SINGLE_SELECT',
              options: [
                { id: 'execution_class_light', name: 'light' },
                { id: 'execution_class_heavy', name: 'heavy' },
              ],
            },
            {
              id: 'field_source_link',
              name: 'Source Link',
              dataType: 'TEXT',
            },
            {
              id: 'field_next_action',
              name: 'Next Action',
              dataType: 'TEXT',
            },
            {
              id: 'field_short_note',
              name: 'Short Note',
              dataType: 'TEXT',
            },
          ],
        },
        items: {
          nodes: items,
        },
      },
    },
  };
}

beforeEach(() => {
  execFileMock.mockReset();
  spawnMock.mockReset();
  octokitRequestMock.mockReset();
  octokitGraphqlMock.mockReset();
  octokitPaginateMock.mockReset();
  octokitConstructorMock.mockReset();

  execFileMock.mockImplementation((_file, args, _options, callback) => {
    if (
      Array.isArray(args) &&
      args[0] === 'auth' &&
      args[1] === 'token' &&
      args[2] === '--hostname' &&
      args[3] === 'github.com'
    ) {
      callback(null, 'test-token\n', '');
      return;
    }

    callback(null, '', '');
  });
});

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
  it('resolveMailboxThreadDetail loads the canonical thread URL and content node id', async () => {
    octokitRequestMock
      .mockResolvedValueOnce({
        data: {
          id: 'thread_1',
          unread: true,
          reason: 'review_requested',
          updated_at: '2026-04-20T10:00:00Z',
          repository: { full_name: 'acme/widgets' },
          subject: {
            title: 'Add mailbox list command',
            type: 'PullRequest',
            url: 'https://api.github.com/repos/acme/widgets/pulls/1',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          html_url: 'https://github.com/acme/widgets/pull/1',
          node_id: 'node_pull_1',
        },
      });

    const detail = await resolveMailboxThreadDetail(
      { ghConfigDir: '/tmp/gh-config' },
      'thread_1',
    );

    expect(detail).toEqual({
      id: 'thread_1',
      repositoryFullName: 'acme/widgets',
      reason: 'review_requested',
      isUnread: true,
      updatedAt: '2026-04-20T10:00:00.000Z',
      subject: {
        title: 'Add mailbox list command',
        type: 'PullRequest',
        url: 'https://github.com/acme/widgets/pull/1',
      },
      contentNodeId: 'node_pull_1',
    });
    expect(octokitConstructorMock).toHaveBeenCalledWith({ auth: 'test-token' });
    expect(octokitRequestMock).toHaveBeenNthCalledWith(
      1,
      'GET /notifications/threads/thread_1',
    );
    expect(octokitRequestMock).toHaveBeenNthCalledWith(
      2,
      'GET /repos/acme/widgets/pulls/1',
    );
  });

  it('promoteMailboxThread adds a project item from content and sets status and source link', async () => {
    octokitGraphqlMock
      .mockResolvedValueOnce({
        data: {
          addProjectV2ItemById: {
            item: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_123' },
          },
        },
      });

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

    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('addProjectV2ItemById'),
      {
        projectId: 'proj_123',
        contentId: 'node_pull_1',
      },
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('singleSelectOptionId'),
      expect.objectContaining({ optionId: 'status_ready' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('value: { text: $value }'),
      expect.objectContaining({
        value: 'https://github.com/acme/widgets/pull/1',
      }),
    );
  });

  it('promoteMailboxThread falls back to a draft project item when no content node id exists', async () => {
    octokitGraphqlMock
      .mockResolvedValueOnce({
        data: {
          addProjectV2DraftIssue: {
            projectItem: { id: 'item_draft_1' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_draft_1' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_draft_1' },
          },
        },
      });

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
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('addProjectV2DraftIssue'),
      {
        projectId: 'proj_123',
        title: 'Triage docs cleanup',
      },
    );
  });

  it('markMailboxThreadAsRead sends the notifications PATCH request', async () => {
    octokitRequestMock.mockResolvedValueOnce({ data: {} });

    const client = createGitHubSignalClient();
    await client.markMailboxThreadAsRead(
      { ghConfigDir: '/tmp/gh-config' },
      'thread_1',
    );

    expect(octokitRequestMock).toHaveBeenCalledWith(
      'PATCH /notifications/threads/thread_1',
    );
  });

  it('getMailboxThreadDetail exposes unread state and canonical URL for show', async () => {
    octokitRequestMock
      .mockResolvedValueOnce({
        data: {
          id: 'thread_2',
          unread: false,
          reason: 'mention',
          updated_at: '2026-04-21T10:00:00Z',
          repository: { full_name: 'acme/docs' },
          subject: {
            title: 'Triage docs cleanup',
            type: 'Issue',
            url: 'https://api.github.com/repos/acme/docs/issues/2',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          html_url: 'https://github.com/acme/docs/issues/2',
          node_id: 'node_issue_2',
        },
      });

    const client = createGitHubSignalClient();
    const detail = await client.getMailboxThreadDetail(
      { ghConfigDir: '/tmp/gh-config' },
      'thread_2',
    );

    expect(detail).toEqual({
      id: 'thread_2',
      repositoryFullName: 'acme/docs',
      reason: 'mention',
      isUnread: false,
      updatedAt: '2026-04-21T10:00:00.000Z',
      subject: {
        title: 'Triage docs cleanup',
        type: 'Issue',
        url: 'https://github.com/acme/docs/issues/2',
      },
      contentNodeId: 'node_issue_2',
    });
  });

  it('listRelatedMailboxCards returns exact Source Link matches only', async () => {
    octokitGraphqlMock.mockResolvedValueOnce(
      createProjectNode([
        {
          id: 'item_match',
          content: { title: 'Matching card' },
          fieldValues: {
            nodes: [
              {
                name: 'Ready',
                field: { id: 'field_status', name: 'Status' },
              },
              {
                text: 'https://github.com/acme/widgets/pull/1',
                field: {
                  id: 'field_source_link',
                  name: 'Source Link',
                },
              },
            ],
          },
        },
        {
          id: 'item_other',
          content: { title: 'Other card' },
          fieldValues: {
            nodes: [
              {
                name: 'Waiting',
                field: { id: 'field_status', name: 'Status' },
              },
              {
                text: 'https://github.com/acme/widgets/pull/99',
                field: {
                  id: 'field_source_link',
                  name: 'Source Link',
                },
              },
            ],
          },
        },
      ]),
    );

    const client = createGitHubSignalClient();
    const cards = await client.listRelatedMailboxCards(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      'https://github.com/acme/widgets/pull/1',
    );

    expect(cards).toEqual([
      {
        id: 'item_match',
        projectId: 'proj_123',
        title: 'Matching card',
        sourceLink: 'https://github.com/acme/widgets/pull/1',
        status: 'Ready',
      },
    ]);
  });

  it('listTaskCards parses project items into compact task rows with filtering', async () => {
    octokitGraphqlMock.mockResolvedValueOnce(
      createProjectNode([
        {
          id: 'item_waiting',
          content: { __typename: 'DraftIssue', title: 'Later task' },
          fieldValues: {
            nodes: [
              {
                name: 'Waiting',
                field: { id: 'field_status', name: 'Status' },
              },
              {
                text: 'P3',
                field: { id: 'field_priority', name: 'Priority' },
              },
              {
                text: 'interaction',
                field: { id: 'field_type', name: 'Type' },
              },
              {
                name: 'heavy',
                field: {
                  id: 'field_execution_class',
                  name: 'Execution Class',
                },
              },
              {
                text: 'https://github.com/acme/docs/issues/2',
                field: {
                  id: 'field_source_link',
                  name: 'Source Link',
                },
              },
            ],
          },
        },
        {
          id: 'item_ready',
          content: { __typename: 'DraftIssue', title: 'Active task' },
          fieldValues: {
            nodes: [
              {
                name: 'Ready',
                field: { id: 'field_status', name: 'Status' },
              },
              {
                text: 'P1',
                field: { id: 'field_priority', name: 'Priority' },
              },
              {
                text: 'execution',
                field: { id: 'field_type', name: 'Type' },
              },
              {
                name: 'light',
                field: {
                  id: 'field_execution_class',
                  name: 'Execution Class',
                },
              },
              {
                text: 'https://github.com/acme/widgets/pull/1',
                field: {
                  id: 'field_source_link',
                  name: 'Source Link',
                },
              },
            ],
          },
        },
      ]),
    );

    const client = createGitHubSignalClient();
    const tasks = await client.listTaskCards(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      {
        statuses: ['ready', 'waiting'],
        type: 'execution',
        executionClass: 'light',
      },
    );

    expect(tasks).toEqual([
      {
        id: 'item_ready',
        title: 'Active task',
        status: 'ready',
        priority: 'P1',
        type: 'execution',
        executionClass: 'light',
        sourceLink: 'https://github.com/acme/widgets/pull/1',
      },
    ]);
  });

  it('getTaskCard returns the full task card object', async () => {
    octokitGraphqlMock.mockResolvedValueOnce(
      createProjectNode([
        {
          id: 'item_123',
          content: {
            __typename: 'DraftIssue',
            title: 'Implement task update',
          },
          fieldValues: {
            nodes: [
              {
                name: 'Doing',
                field: { id: 'field_status', name: 'Status' },
              },
              {
                text: 'P1',
                field: { id: 'field_priority', name: 'Priority' },
              },
              {
                text: 'execution',
                field: { id: 'field_type', name: 'Type' },
              },
              {
                name: 'heavy',
                field: {
                  id: 'field_execution_class',
                  name: 'Execution Class',
                },
              },
              {
                text: 'https://github.com/acme/widgets/issues/12',
                field: {
                  id: 'field_source_link',
                  name: 'Source Link',
                },
              },
              {
                text: 'Ship the mutations',
                field: {
                  id: 'field_next_action',
                  name: 'Next Action',
                },
              },
              {
                text: 'Actively being implemented',
                field: {
                  id: 'field_short_note',
                  name: 'Short Note',
                },
              },
            ],
          },
        },
      ]),
    );

    const client = createGitHubSignalClient();
    const task = await client.getTaskCard(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      'item_123',
    );

    expect(task).toEqual({
      id: 'item_123',
      projectId: 'proj_123',
      title: 'Implement task update',
      status: 'doing',
      priority: 'P1',
      type: 'execution',
      executionClass: 'heavy',
      sourceLink: 'https://github.com/acme/widgets/issues/12',
      nextAction: 'Ship the mutations',
      shortNote: 'Actively being implemented',
    });
  });

  it('createTaskCard creates a draft item and applies all supported fields', async () => {
    octokitGraphqlMock
      .mockResolvedValueOnce({
        data: {
          addProjectV2DraftIssue: {
            projectItem: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_created' },
          },
        },
      })
      .mockResolvedValueOnce(
        createProjectNode([
          {
            id: 'item_created',
            content: { __typename: 'DraftIssue', title: 'New task' },
            fieldValues: {
              nodes: [
                {
                  name: 'Doing',
                  field: { id: 'field_status', name: 'Status' },
                },
                {
                  text: 'P1',
                  field: { id: 'field_priority', name: 'Priority' },
                },
                {
                  text: 'execution',
                  field: { id: 'field_type', name: 'Type' },
                },
                {
                  name: 'heavy',
                  field: {
                    id: 'field_execution_class',
                    name: 'Execution Class',
                  },
                },
                {
                  text: 'https://github.com/acme/widgets/issues/20',
                  field: {
                    id: 'field_source_link',
                    name: 'Source Link',
                  },
                },
                {
                  text: 'Write the task commands',
                  field: {
                    id: 'field_next_action',
                    name: 'Next Action',
                  },
                },
                {
                  text: 'Created in test',
                  field: {
                    id: 'field_short_note',
                    name: 'Short Note',
                  },
                },
              ],
            },
          },
        ]),
      );

    const client = createGitHubSignalClient();
    const task = await client.createTaskCard(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      {
        title: 'New task',
        status: 'doing',
        priority: 'P1',
        type: 'execution',
        executionClass: 'heavy',
        sourceLink: 'https://github.com/acme/widgets/issues/20',
        nextAction: 'Write the task commands',
        shortNote: 'Created in test',
      },
    );

    expect(task.id).toBe('item_created');
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('addProjectV2DraftIssue'),
      {
        projectId: 'proj_123',
        title: 'New task',
      },
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('singleSelectOptionId'),
      expect.objectContaining({ optionId: 'status_doing' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('value: { text: $value }'),
      expect.objectContaining({ value: 'P1' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('value: { text: $value }'),
      expect.objectContaining({ value: 'execution' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      5,
      expect.stringContaining('singleSelectOptionId'),
      expect.objectContaining({ optionId: 'execution_class_heavy' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      6,
      expect.stringContaining('value: { text: $value }'),
      expect.objectContaining({
        value: 'https://github.com/acme/widgets/issues/20',
      }),
    );
  });

  it('updateTaskCard updates text fields, execution class, and title for draft tasks', async () => {
    octokitGraphqlMock
      .mockResolvedValueOnce(
        createProjectNode([
          {
            id: 'item_123',
            content: { __typename: 'DraftIssue', title: 'Old title' },
            fieldValues: {
              nodes: [
                {
                  name: 'Ready',
                  field: { id: 'field_status', name: 'Status' },
                },
              ],
            },
          },
        ]),
      )
      .mockResolvedValueOnce({
        data: {
          updateProjectV2DraftIssue: {
            draftIssue: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce(
        createProjectNode([
          {
            id: 'item_123',
            content: {
              __typename: 'DraftIssue',
              title: 'New title',
            },
            fieldValues: {
              nodes: [
                {
                  name: 'Ready',
                  field: { id: 'field_status', name: 'Status' },
                },
                {
                  text: 'Ship the feature',
                  field: {
                    id: 'field_next_action',
                    name: 'Next Action',
                  },
                },
                {
                  name: 'heavy',
                  field: {
                    id: 'field_execution_class',
                    name: 'Execution Class',
                  },
                },
              ],
            },
          },
        ]),
      );

    const client = createGitHubSignalClient();
    const task = await client.updateTaskCard(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      'item_123',
      {
        title: 'New title',
        nextAction: 'Ship the feature',
        executionClass: 'heavy',
      },
    );

    expect(task.title).toBe('New title');
    expect(task.nextAction).toBe('Ship the feature');
    expect(task.executionClass).toBe('heavy');
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('updateProjectV2DraftIssue'),
      {
        itemId: 'item_123',
        title: 'New title',
      },
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('value: { text: $value }'),
      expect.objectContaining({ value: 'Ship the feature' }),
    );
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('singleSelectOptionId'),
      expect.objectContaining({ optionId: 'execution_class_heavy' }),
    );
  });

  it('setTaskCardStatus updates a single card status and returns the full card', async () => {
    octokitGraphqlMock
      .mockResolvedValueOnce(
        createProjectNode([
          {
            id: 'item_123',
            content: { __typename: 'DraftIssue', title: 'Task' },
            fieldValues: {
              nodes: [
                {
                  name: 'Ready',
                  field: { id: 'field_status', name: 'Status' },
                },
              ],
            },
          },
        ]),
      )
      .mockResolvedValueOnce({
        data: {
          updateProjectV2ItemFieldValue: {
            projectV2Item: { id: 'item_123' },
          },
        },
      })
      .mockResolvedValueOnce(
        createProjectNode([
          {
            id: 'item_123',
            content: { __typename: 'DraftIssue', title: 'Task' },
            fieldValues: {
              nodes: [
                {
                  name: 'Done',
                  field: { id: 'field_status', name: 'Status' },
                },
              ],
            },
          },
        ]),
      );

    const client = createGitHubSignalClient();
    const task = await client.setTaskCardStatus(
      { ghConfigDir: '/tmp/gh-config' },
      createConfig(),
      'item_123',
      'done',
    );

    expect(task.status).toBe('done');
    expect(octokitGraphqlMock).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('singleSelectOptionId'),
      expect.objectContaining({ optionId: 'status_done' }),
    );
  });
});
