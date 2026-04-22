import { describe, expect, it } from 'vitest';

import {
  parseMailboxNotificationsPayload,
  sortMailboxNotificationsOldestFirst,
} from './github.js';

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
