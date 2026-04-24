import type {
  TaskExecutionClass,
  GitHubSignalClient,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../../core/types.js';
import {
  buildTaskCreateInput,
  TaskCommandOptions,
  withTaskCommandContext,
} from './common.js';

export interface TaskCreateCommandOptions extends TaskCommandOptions {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  executionClass?: TaskExecutionClass;
  sourceLink?: string;
  nextAction?: string;
  shortNote?: string;
}

export async function taskCreateCommand(
  options: TaskCreateCommandOptions,
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const input = buildTaskCreateInput(options);

  await withTaskCommandContext(options, dependencies, async (context) => {
    const task = await context.githubClient.createTaskCard(
      context.paths,
      context.config,
      input,
    );

    console.log(JSON.stringify(task, null, 2));
  });
}
