import type {
  Config,
  EnsuredGitHubProject,
  GitHubAuthStatus,
  GitHubSignalClient,
  MailboxNotification,
  MailboxProjectCard,
  MailboxPromotionStatus,
  MailboxPromotionTarget,
  MailboxThreadDetail,
  SignalSummary,
  TaskCard,
  TaskCreateInput,
  TaskListFilters,
  TaskListItem,
  TaskStatus,
  TaskUpdateInput,
} from '../types.js';
import type { WorkspacePaths } from '../workspace.js';
import { defaultGhAuthClient } from './auth.js';
import { defaultGitHubApiClient } from './api.js';
import {
  DEFAULT_PROJECT_TITLE,
  type GhAuthClient,
  type GitHubApiClient,
} from './internal.js';
import {
  getUnreadCount,
  listProjectCardsBySourceLink,
  listUnreadNotifications,
  resolveMailboxThreadDetail,
} from './mailbox.js';
import {
  addProjectDraftItem,
  addProjectItemFromContent,
  assertConfiguredProject,
  buildProjectConfig,
  clearProjectItemFieldValue,
  ensureProject,
  fetchProjectById,
  getRequiredProjectFieldId,
  getStatusOptionId,
  loadConfiguredProject,
  setProjectItemStatus,
  setProjectItemTextField,
  updateProjectDraftItemTitle,
} from './project.js';
import { GitHubConfigError, GitHubRuntimeError } from './errors.js';
import {
  applyTaskFilters,
  countActionableProjectItems,
  findTaskCard,
  getProjectItemContentType,
  listTaskCardsFromProject,
  sortTaskCards,
  toTaskListItem,
} from './tasks.js';

class DefaultGitHubSignalClient implements GitHubSignalClient {
  constructor(
    private readonly authClient: GhAuthClient,
    private readonly apiClient: GitHubApiClient,
  ) {}

  async login(paths: Pick<WorkspacePaths, 'ghConfigDir'>): Promise<void> {
    await this.authClient.login(paths);
  }

  async refreshProjectScopes(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<void> {
    await this.authClient.refreshProjectScopes(paths);
  }

  async ensureProject(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    projectTitle = DEFAULT_PROJECT_TITLE,
  ): Promise<EnsuredGitHubProject> {
    const result = await ensureProject(paths, projectTitle);

    return {
      wasCreated: result.wasCreated,
      ...result.config,
    };
  }

  async getSignalSummary(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
  ): Promise<SignalSummary> {
    assertConfiguredProject(config);

    const unreadCount = await getUnreadCount(paths);
    const project = await fetchProjectById(paths, config.projectId as string);
    const projectConfig = buildProjectConfig(project);

    if (
      projectConfig.projectFieldIds.status !== config.projectFieldIds.status
    ) {
      throw new GitHubConfigError(
        'Configured GitHub Project Status field changed. Run gh-agent init.',
      );
    }

    return {
      unreadCount,
      actionableCount: countActionableProjectItems(project),
    };
  }

  async listMailboxNotifications(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    options: { limit?: number } = {},
  ): Promise<MailboxNotification[]> {
    return listUnreadNotifications(paths, options);
  }

  async getMailboxThreadDetail(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<MailboxThreadDetail> {
    const detail = await resolveMailboxThreadDetail(paths, threadId);

    return {
      id: detail.id,
      repositoryFullName: detail.repositoryFullName,
      reason: detail.reason,
      isUnread: detail.isUnread,
      updatedAt: detail.updatedAt,
      subject: detail.subject,
      contentNodeId: detail.contentNodeId,
    };
  }

  async promoteMailboxThread(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    target: MailboxPromotionTarget,
    status: MailboxPromotionStatus,
  ): Promise<MailboxProjectCard> {
    assertConfiguredProject(config);

    const projectId = config.projectId as string;
    const itemId =
      target.contentNodeId === null
        ? await addProjectDraftItem(paths, projectId, target.title)
        : await addProjectItemFromContent(
            paths,
            projectId,
            target.contentNodeId,
          );

    await setProjectItemStatus(
      paths,
      projectId,
      itemId,
      getRequiredProjectFieldId(config.projectFieldIds.status, 'Status'),
      getStatusOptionId(config, status),
    );
    await setProjectItemTextField(
      paths,
      projectId,
      itemId,
      getRequiredProjectFieldId(
        config.projectFieldIds.sourceLink,
        'Source Link',
      ),
      target.sourceUrl,
    );

    return {
      id: itemId,
      projectId,
      title: target.title,
      sourceLink: target.sourceUrl,
      status,
    };
  }

  async markMailboxThreadAsRead(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    threadId: string,
  ): Promise<void> {
    await this.apiClient.markMailboxThreadAsRead(paths, threadId);
  }

  async listRelatedMailboxCards(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    sourceUrl: string,
  ): Promise<MailboxProjectCard[]> {
    const projectId = config.projectId as string;
    const project = await loadConfiguredProject(paths, config);

    return listProjectCardsBySourceLink(project, projectId, sourceUrl);
  }

  async listTaskCards(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    filters: TaskListFilters = {},
  ): Promise<TaskListItem[]> {
    const projectId = config.projectId as string;
    const project = await loadConfiguredProject(paths, config);
    const tasks = sortTaskCards(
      applyTaskFilters(listTaskCardsFromProject(project, projectId), filters),
    );

    return tasks.map((task) => toTaskListItem(task));
  }

  async getTaskCard(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    taskId: string,
  ): Promise<TaskCard> {
    const projectId = config.projectId as string;
    const project = await loadConfiguredProject(paths, config);
    const tasks = listTaskCardsFromProject(project, projectId);

    return findTaskCard(tasks, taskId);
  }

  async createTaskCard(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    input: TaskCreateInput,
  ): Promise<TaskCard> {
    assertConfiguredProject(config);

    const projectId = config.projectId as string;
    const itemId = await addProjectDraftItem(paths, projectId, input.title);

    await setProjectItemStatus(
      paths,
      projectId,
      itemId,
      getRequiredProjectFieldId(config.projectFieldIds.status, 'Status'),
      getStatusOptionId(config, input.status),
    );

    if (input.priority !== undefined && input.priority !== null) {
      await setProjectItemTextField(
        paths,
        projectId,
        itemId,
        getRequiredProjectFieldId(config.projectFieldIds.priority, 'Priority'),
        input.priority,
      );
    }

    if (input.type !== undefined && input.type !== null) {
      await setProjectItemTextField(
        paths,
        projectId,
        itemId,
        getRequiredProjectFieldId(config.projectFieldIds.type, 'Type'),
        input.type,
      );
    }

    if (input.sourceLink !== undefined && input.sourceLink !== null) {
      await setProjectItemTextField(
        paths,
        projectId,
        itemId,
        getRequiredProjectFieldId(
          config.projectFieldIds.sourceLink,
          'Source Link',
        ),
        input.sourceLink,
      );
    }

    if (input.nextAction !== undefined && input.nextAction !== null) {
      await setProjectItemTextField(
        paths,
        projectId,
        itemId,
        getRequiredProjectFieldId(
          config.projectFieldIds.nextAction,
          'Next Action',
        ),
        input.nextAction,
      );
    }

    if (input.shortNote !== undefined && input.shortNote !== null) {
      await setProjectItemTextField(
        paths,
        projectId,
        itemId,
        getRequiredProjectFieldId(
          config.projectFieldIds.shortNote,
          'Short Note',
        ),
        input.shortNote,
      );
    }

    return this.getTaskCard(paths, config, itemId);
  }

  async updateTaskCard(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    taskId: string,
    input: TaskUpdateInput,
  ): Promise<TaskCard> {
    assertConfiguredProject(config);

    const projectId = config.projectId as string;
    const project = await loadConfiguredProject(paths, config);
    const targetItem = (project.items?.nodes ?? []).find(
      (item) => item.id === taskId,
    );

    if (targetItem === undefined) {
      throw new GitHubRuntimeError(
        `GitHub Project item "${taskId}" was not found in the configured project.`,
      );
    }

    if (input.title !== undefined) {
      if (getProjectItemContentType(targetItem) !== 'DraftIssue') {
        throw new GitHubRuntimeError(
          `GitHub Project item "${taskId}" does not support title updates because it is not a draft task.`,
        );
      }

      await updateProjectDraftItemTitle(paths, taskId, input.title);
    }

    if (input.status !== undefined) {
      await setProjectItemStatus(
        paths,
        projectId,
        taskId,
        getRequiredProjectFieldId(config.projectFieldIds.status, 'Status'),
        getStatusOptionId(config, input.status),
      );
    }

    const textFieldUpdates: Array<{
      value: string | null | undefined;
      fieldId: string | null;
      fieldName: string;
    }> = [
      {
        value: input.priority,
        fieldId: config.projectFieldIds.priority,
        fieldName: 'Priority',
      },
      {
        value: input.type,
        fieldId: config.projectFieldIds.type,
        fieldName: 'Type',
      },
      {
        value: input.sourceLink,
        fieldId: config.projectFieldIds.sourceLink,
        fieldName: 'Source Link',
      },
      {
        value: input.nextAction,
        fieldId: config.projectFieldIds.nextAction,
        fieldName: 'Next Action',
      },
      {
        value: input.shortNote,
        fieldId: config.projectFieldIds.shortNote,
        fieldName: 'Short Note',
      },
    ];

    for (const update of textFieldUpdates) {
      if (update.value === undefined) {
        continue;
      }

      const fieldId = getRequiredProjectFieldId(
        update.fieldId,
        update.fieldName,
      );

      if (update.value === null) {
        await clearProjectItemFieldValue(paths, projectId, taskId, fieldId);
      } else {
        await setProjectItemTextField(
          paths,
          projectId,
          taskId,
          fieldId,
          update.value,
        );
      }
    }

    return this.getTaskCard(paths, config, taskId);
  }

  async setTaskCardStatus(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
    config: Config,
    taskId: string,
    status: TaskStatus,
  ): Promise<TaskCard> {
    return this.updateTaskCard(paths, config, taskId, { status });
  }

  async getAuthStatus(
    paths: Pick<WorkspacePaths, 'ghConfigDir'>,
  ): Promise<GitHubAuthStatus> {
    return this.authClient.getAuthStatus(paths);
  }
}

export function createGitHubSignalClient(): GitHubSignalClient {
  return new DefaultGitHubSignalClient(
    defaultGhAuthClient,
    defaultGitHubApiClient,
  );
}
