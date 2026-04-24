import type {
  TaskCard,
  TaskListFilters,
  TaskListItem,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../types.js';
import { GitHubRuntimeError } from './errors.js';
import {
  ACTIONABLE_STATUS_NAMES,
  ProjectFieldValueNode,
  ProjectItemNode,
  ProjectNode,
  TASK_PRIORITY_VALUES,
  TASK_TYPE_VALUES,
} from './internal.js';

export function countActionableProjectItems(project: ProjectNode): number {
  const items = project.items?.nodes ?? [];

  return items.filter((item) =>
    (item.fieldValues?.nodes ?? []).some(
      (fieldValue) =>
        fieldValue.field?.name === 'Status' &&
        typeof fieldValue.name === 'string' &&
        ACTIONABLE_STATUS_NAMES.has(fieldValue.name),
    ),
  ).length;
}

function getProjectItemFieldValue(
  item: ProjectItemNode,
  fieldName: string,
): ProjectFieldValueNode | null {
  return (
    (item.fieldValues?.nodes ?? []).find(
      (fieldValue) => fieldValue.field?.name === fieldName,
    ) ?? null
  );
}

export function getProjectItemTitle(item: ProjectItemNode): string | null {
  const contentTitle =
    typeof item.content?.title === 'string' && item.content.title.length > 0
      ? item.content.title
      : null;

  return contentTitle;
}

export function getProjectItemContentType(
  item: ProjectItemNode,
): string | null {
  return typeof item.content?.__typename === 'string' &&
    item.content.__typename.length > 0
    ? item.content.__typename
    : null;
}

export function getProjectItemStatusName(item: ProjectItemNode): string | null {
  const statusValue = getProjectItemFieldValue(item, 'Status');

  return typeof statusValue?.name === 'string' && statusValue.name.length > 0
    ? statusValue.name
    : null;
}

export function getProjectItemTextValue(
  item: ProjectItemNode,
  fieldName: string,
): string | null {
  const textValue = getProjectItemFieldValue(item, fieldName);

  return typeof textValue?.text === 'string' && textValue.text.length > 0
    ? textValue.text
    : null;
}

function parseTaskStatusValue(value: string | null): TaskStatus | null {
  switch (value) {
    case 'Ready':
      return 'ready';
    case 'Doing':
      return 'doing';
    case 'Waiting':
      return 'waiting';
    case 'Done':
      return 'done';
    default:
      return null;
  }
}

function parseTaskPriorityValue(value: string | null): TaskPriority | null {
  return value !== null && TASK_PRIORITY_VALUES.has(value)
    ? (value as TaskPriority)
    : null;
}

function parseTaskTypeValue(value: string | null): TaskType | null {
  return value !== null && TASK_TYPE_VALUES.has(value)
    ? (value as TaskType)
    : null;
}

function getTaskStatusSortRank(status: TaskStatus): number {
  switch (status) {
    case 'ready':
      return 0;
    case 'doing':
      return 1;
    case 'waiting':
      return 2;
    case 'done':
      return 3;
  }
}

function requireTaskCardFromItem(
  item: ProjectItemNode,
  projectId: string,
): TaskCard {
  const itemId =
    typeof item.id === 'string' && item.id.length > 0 ? item.id : null;
  const title = getProjectItemTitle(item);
  const status = parseTaskStatusValue(getProjectItemStatusName(item));

  if (itemId === null || title === null || status === null) {
    throw new GitHubRuntimeError(
      'GitHub Project contains an item that is missing id, title, or Status.',
    );
  }

  return {
    id: itemId,
    projectId,
    title,
    status,
    priority: parseTaskPriorityValue(getProjectItemTextValue(item, 'Priority')),
    type: parseTaskTypeValue(getProjectItemTextValue(item, 'Type')),
    sourceLink: getProjectItemTextValue(item, 'Source Link'),
    nextAction: getProjectItemTextValue(item, 'Next Action'),
    shortNote: getProjectItemTextValue(item, 'Short Note'),
  };
}

export function toTaskListItem(task: TaskCard): TaskListItem {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    sourceLink: task.sourceLink,
  };
}

export function listTaskCardsFromProject(
  project: ProjectNode,
  projectId: string,
): TaskCard[] {
  return (project.items?.nodes ?? []).map((item) =>
    requireTaskCardFromItem(item, projectId),
  );
}

export function applyTaskFilters(
  tasks: TaskCard[],
  filters: TaskListFilters = {},
): TaskCard[] {
  return tasks.filter((task) => {
    if (
      Array.isArray(filters.statuses) &&
      filters.statuses.length > 0 &&
      !filters.statuses.includes(task.status)
    ) {
      return false;
    }

    if (filters.priority !== undefined && task.priority !== filters.priority) {
      return false;
    }

    if (filters.type !== undefined && task.type !== filters.type) {
      return false;
    }

    return true;
  });
}

export function sortTaskCards(tasks: TaskCard[]): TaskCard[] {
  return [...tasks].sort((left, right) => {
    const rankDifference =
      getTaskStatusSortRank(left.status) - getTaskStatusSortRank(right.status);

    if (rankDifference !== 0) {
      return rankDifference;
    }

    const titleDifference = left.title.localeCompare(right.title);

    if (titleDifference !== 0) {
      return titleDifference;
    }

    return left.id.localeCompare(right.id);
  });
}

export function findTaskCard(tasks: TaskCard[], taskId: string): TaskCard {
  const task = tasks.find((candidate) => candidate.id === taskId);

  if (task === undefined) {
    throw new GitHubRuntimeError(
      `GitHub Project item "${taskId}" was not found in the configured project.`,
    );
  }

  return task;
}
