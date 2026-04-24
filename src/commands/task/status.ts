import type {
  GitHubSignalClient,
  TaskStatus,
  TaskStatusUpdateResult,
} from '../../core/types.js';
import {
  createTaskStatusFailureResult,
  formatTaskStatusResultsJson,
  TaskCommandOptions,
  toTaskListItem,
  withTaskCommandContext,
} from './common.js';

async function runTaskStatusCommand(
  taskIds: string[],
  status: TaskStatus,
  options: TaskCommandOptions,
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await withTaskCommandContext(options, dependencies, async (context) => {
    const results: TaskStatusUpdateResult[] = [];

    for (const taskId of taskIds) {
      try {
        const task = await context.githubClient.setTaskCardStatus(
          context.paths,
          context.config,
          taskId,
          status,
        );

        results.push({
          taskId,
          status,
          ok: true,
          task: toTaskListItem(task),
        });
      } catch (error) {
        results.push(createTaskStatusFailureResult(taskId, status, error));
      }
    }

    console.log(formatTaskStatusResultsJson(results));

    if (results.some((result) => !result.ok)) {
      throw Object.assign(
        new Error('One or more task status updates failed.'),
        { exitCode: 1 },
      );
    }
  });
}

export async function taskReadyCommand(
  taskIds: string[],
  options: TaskCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runTaskStatusCommand(taskIds, 'ready', options, dependencies);
}

export async function taskWaitCommand(
  taskIds: string[],
  options: TaskCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runTaskStatusCommand(taskIds, 'waiting', options, dependencies);
}

export async function taskDoingCommand(
  taskIds: string[],
  options: TaskCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runTaskStatusCommand(taskIds, 'doing', options, dependencies);
}

export async function taskDoneCommand(
  taskIds: string[],
  options: TaskCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await runTaskStatusCommand(taskIds, 'done', options, dependencies);
}
