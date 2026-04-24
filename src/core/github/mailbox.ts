import type {
  MailboxNotification,
  MailboxProjectCard,
  MailboxThreadDetail,
} from '../types.js';
import type { WorkspacePaths } from '../workspace.js';
import { defaultGitHubApiClient } from './api.js';
import { GitHubRuntimeError } from './errors.js';
import type { NotificationThread, ProjectNode } from './internal.js';
import {
  getProjectItemStatusName,
  getProjectItemTextValue,
  getProjectItemTitle,
} from './tasks.js';

export function parseMailboxNotificationsPayload(
  stdout: string,
): MailboxNotification[] {
  const parsed = JSON.parse(stdout) as
    | NotificationThread[]
    | NotificationThread[][];

  if (!Array.isArray(parsed)) {
    return [];
  }

  const threads = parsed.every((item) => Array.isArray(item))
    ? (parsed as NotificationThread[][]).flat()
    : (parsed as NotificationThread[]);

  return threads.flatMap((thread) => {
    if (typeof thread?.id !== 'string' || thread.id.length === 0) {
      return [];
    }

    const repositoryFullName =
      typeof thread.repository?.full_name === 'string' &&
      thread.repository.full_name.length > 0
        ? thread.repository.full_name
        : typeof thread.repository?.owner?.login === 'string' &&
            thread.repository.owner.login.length > 0 &&
            typeof thread.repository?.name === 'string' &&
            thread.repository.name.length > 0
          ? `${thread.repository.owner.login}/${thread.repository.name}`
          : null;

    const title =
      typeof thread.subject?.title === 'string' &&
      thread.subject.title.length > 0
        ? thread.subject.title
        : null;

    const reason =
      typeof thread.reason === 'string' && thread.reason.length > 0
        ? thread.reason
        : null;
    const updatedAt =
      typeof thread.updated_at === 'string' &&
      !Number.isNaN(new Date(thread.updated_at).getTime())
        ? new Date(thread.updated_at).toISOString()
        : null;

    if (repositoryFullName === null || title === null || reason === null) {
      return [];
    }

    return [
      {
        id: thread.id,
        repositoryFullName,
        title,
        reason,
        type:
          typeof thread.subject?.type === 'string' &&
          thread.subject.type.length > 0
            ? thread.subject.type
            : null,
        updatedAt,
      },
    ];
  });
}

export function sortMailboxNotificationsOldestFirst(
  notifications: MailboxNotification[],
): MailboxNotification[] {
  return [...notifications].sort((left, right) => {
    const leftTime =
      left.updatedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(left.updatedAt);
    const rightTime =
      right.updatedAt === null
        ? Number.POSITIVE_INFINITY
        : Date.parse(right.updatedAt);

    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }

    return left.id.localeCompare(right.id);
  });
}

export async function listUnreadNotifications(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  options: { limit?: number } = {},
): Promise<MailboxNotification[]> {
  const notifications = sortMailboxNotificationsOldestFirst(
    (await defaultGitHubApiClient.listUnreadNotifications(paths)).flatMap(
      (thread) => parseMailboxNotificationsPayload(JSON.stringify([thread])),
    ),
  );
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? options.limit
      : notifications.length;

  return notifications.slice(0, Math.max(0, limit));
}

export async function getUnreadCount(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
): Promise<number> {
  return (await listUnreadNotifications(paths)).length;
}

async function getNotificationThread(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  threadId: string,
): Promise<NotificationThread> {
  const thread = await defaultGitHubApiClient.getNotificationThread(
    paths,
    threadId,
  );

  if (typeof thread.id !== 'string' || thread.id.length === 0) {
    throw new GitHubRuntimeError(
      `GitHub notification thread "${threadId}" was not found.`,
    );
  }

  return thread;
}

export async function resolveMailboxThreadDetail(
  paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  threadId: string,
): Promise<MailboxThreadDetail> {
  const thread = await getNotificationThread(paths, threadId);
  const repositoryFullName =
    typeof thread.repository?.full_name === 'string' &&
    thread.repository.full_name.length > 0
      ? thread.repository.full_name
      : typeof thread.repository?.owner?.login === 'string' &&
          thread.repository.owner.login.length > 0 &&
          typeof thread.repository?.name === 'string' &&
          thread.repository.name.length > 0
        ? `${thread.repository.owner.login}/${thread.repository.name}`
        : null;
  const title =
    typeof thread.subject?.title === 'string' && thread.subject.title.length > 0
      ? thread.subject.title
      : null;
  const reason =
    typeof thread.reason === 'string' && thread.reason.length > 0
      ? thread.reason
      : null;
  const subjectUrl =
    typeof thread.subject?.url === 'string' && thread.subject.url.length > 0
      ? thread.subject.url
      : null;
  const updatedAt =
    typeof thread.updated_at === 'string' &&
    !Number.isNaN(new Date(thread.updated_at).getTime())
      ? new Date(thread.updated_at).toISOString()
      : null;
  const isUnread = thread.unread === true;

  if (
    repositoryFullName === null ||
    title === null ||
    reason === null ||
    subjectUrl === null
  ) {
    throw new GitHubRuntimeError(
      `GitHub notification thread "${threadId}" is missing required subject metadata.`,
    );
  }

  const resource = await defaultGitHubApiClient.getResourceByUrl(
    paths,
    subjectUrl,
  );

  if (typeof resource.html_url !== 'string' || resource.html_url.length === 0) {
    throw new GitHubRuntimeError(
      `GitHub notification thread "${threadId}" is missing a canonical source URL.`,
    );
  }

  return {
    id: thread.id as string,
    repositoryFullName,
    reason,
    isUnread,
    updatedAt,
    subject: {
      title,
      type:
        typeof thread.subject?.type === 'string' &&
        thread.subject.type.length > 0
          ? thread.subject.type
          : null,
      url: resource.html_url,
    },
  };
}

export function listProjectCardsBySourceLink(
  project: ProjectNode,
  projectId: string,
  sourceUrl: string,
): MailboxProjectCard[] {
  return (project.items?.nodes ?? []).flatMap((item) => {
    const itemId =
      typeof item.id === 'string' && item.id.length > 0 ? item.id : null;
    const title = getProjectItemTitle(item);
    const status = getProjectItemStatusName(item);
    const sourceLink = getProjectItemTextValue(item, 'Source Link');

    if (
      itemId === null ||
      title === null ||
      status === null ||
      sourceLink === null ||
      sourceLink !== sourceUrl
    ) {
      return [];
    }

    return [
      {
        id: itemId,
        projectId,
        title,
        sourceLink,
        status,
      },
    ];
  });
}
