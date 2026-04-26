import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../../core/github.js';
import type {
  Config,
  GitHubSignalClient,
  TaskCard,
  TaskCreateInput,
  TaskExecutionClass,
  TaskListFilters,
  TaskListItem,
  TaskPriority,
  TaskStatus,
  TaskStatusUpdateErrorResult,
  TaskStatusUpdateResult,
  TaskType,
  TaskUpdateInput,
} from '../../core/types.js';
import {
  ensureConfig,
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../../core/workspace.js';

export interface TaskCommandOptions {
  cwd?: string;
}

export function parseTaskStatusOption(value: string): TaskStatus {
  if (
    value !== 'ready' &&
    value !== 'doing' &&
    value !== 'waiting' &&
    value !== 'done'
  ) {
    throw new Error(
      'The status must be one of "ready", "doing", "waiting", or "done".',
    );
  }

  return value;
}

export function parseTaskPriorityOption(value: string): TaskPriority {
  if (value !== 'P1' && value !== 'P2' && value !== 'P3') {
    throw new Error('The priority must be one of "P1", "P2", or "P3".');
  }

  return value;
}

export function parseTaskTypeOption(value: string): TaskType {
  if (value !== 'interaction' && value !== 'execution') {
    throw new Error('The type must be either "interaction" or "execution".');
  }

  return value;
}

export function parseTaskExecutionClassOption(
  value: string,
): TaskExecutionClass {
  if (value !== 'light' && value !== 'heavy') {
    throw new Error('The execution class must be either "light" or "heavy".');
  }

  return value;
}

export function parseTaskStatusFilterOption(
  value: string,
  previous: TaskStatus[] = [],
): TaskStatus[] {
  return [
    ...previous,
    ...value.split(',').map((part) => parseTaskStatusOption(part.trim())),
  ];
}

export function formatTaskListJson(tasks: TaskListItem[]): string {
  if (tasks.length === 0) {
    return '[]';
  }

  return `[\n  ${tasks.map((task) => JSON.stringify(task)).join(',\n  ')}\n]`;
}

export function formatTaskStatusResultsJson(
  results: TaskStatusUpdateResult[],
): string {
  if (results.length === 0) {
    return '[]';
  }

  return `[\n  ${results.map((result) => JSON.stringify(result)).join(',\n  ')}\n]`;
}

export function createTaskStatusFailureResult(
  taskId: string,
  status: TaskStatus,
  error: unknown,
): TaskStatusUpdateErrorResult {
  if (error instanceof GitHubAuthError) {
    return {
      taskId,
      status,
      ok: false,
      error: error.message,
      errorCategory: 'auth',
    };
  }

  if (error instanceof GitHubConfigError) {
    return {
      taskId,
      status,
      ok: false,
      error: error.message,
      errorCategory: 'config',
    };
  }

  return {
    taskId,
    status,
    ok: false,
    error: error instanceof Error ? error.message : 'Unknown task update error',
    errorCategory: 'runtime',
  };
}

export function toTaskListItem(task: TaskCard): TaskListItem {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    type: task.type,
    executionClass: task.executionClass,
    sourceLink: task.sourceLink,
    nextAction: task.nextAction,
    shortNote: task.shortNote,
  };
}

export function hasTaskUpdateInput(input: TaskUpdateInput): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

export function buildTaskCreateInput(options: {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  executionClass?: TaskExecutionClass;
  sourceLink?: string;
  nextAction?: string;
  shortNote?: string;
}): TaskCreateInput {
  if (options.title === undefined || options.title.length === 0) {
    throw Object.assign(new Error('The --title option is required.'), {
      exitCode: 1,
    });
  }

  if (options.status === undefined) {
    throw Object.assign(new Error('The --status option is required.'), {
      exitCode: 1,
    });
  }

  return {
    title: options.title,
    status: options.status,
    priority: options.priority,
    type: options.type,
    executionClass: options.executionClass,
    sourceLink: options.sourceLink,
    nextAction: options.nextAction,
    shortNote: options.shortNote,
  };
}

export function buildTaskUpdateInput(options: {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  executionClass?: TaskExecutionClass;
  sourceLink?: string;
  nextAction?: string;
  shortNote?: string;
}): TaskUpdateInput {
  return {
    title: options.title,
    status: options.status,
    priority: options.priority,
    type: options.type,
    executionClass: options.executionClass,
    sourceLink: options.sourceLink,
    nextAction: options.nextAction,
    shortNote: options.shortNote,
  };
}

export async function withTaskCommandContext<T>(
  options: TaskCommandOptions,
  dependencies: {
    githubClient?: GitHubSignalClient;
  },
  run: (context: {
    githubClient: GitHubSignalClient;
    config: Config;
    paths: ReturnType<typeof getWorkspacePaths>;
  }) => Promise<T>,
): Promise<T> {
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);

    await ensureWorkspaceStructure(paths);
    const config = await ensureConfig(paths);
    const authStatus = await githubClient.getAuthStatus(paths);

    if (authStatus.kind !== 'authenticated') {
      throw new GitHubAuthError(authStatus.detail);
    }

    return await run({
      githubClient,
      config,
      paths,
    });
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
