import type {
  GitHubSignalClient,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '../../core/types.js';
import {
  buildTaskUpdateInput,
  hasTaskUpdateInput,
  TaskCommandOptions,
  withTaskCommandContext,
} from './common.js';

export interface TaskUpdateCommandOptions extends TaskCommandOptions {
  title?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  type?: TaskType;
  sourceLink?: string;
  nextAction?: string;
  shortNote?: string;
}

export async function taskUpdateCommand(
  taskId: string,
  options: TaskUpdateCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const input = buildTaskUpdateInput(options);

  if (!hasTaskUpdateInput(input)) {
    throw Object.assign(
      new Error('At least one task field option must be provided for update.'),
      { exitCode: 1 },
    );
  }

  await withTaskCommandContext(options, dependencies, async (context) => {
    const task = await context.githubClient.updateTaskCard(
      context.paths,
      context.config,
      taskId,
      input,
    );

    console.log(JSON.stringify(task, null, 2));
  });
}
