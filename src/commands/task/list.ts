import type { GitHubSignalClient, TaskListFilters } from '../../core/types.js';
import {
  formatTaskListJson,
  TaskCommandOptions,
  withTaskCommandContext,
} from './common.js';

export interface TaskListCommandOptions extends TaskCommandOptions {
  statuses?: TaskListFilters['statuses'];
  priority?: TaskListFilters['priority'];
  type?: TaskListFilters['type'];
}

export async function taskListCommand(
  options: TaskListCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await withTaskCommandContext(options, dependencies, async (context) => {
    const tasks = await context.githubClient.listTaskCards(
      context.paths,
      context.config,
      {
        statuses: options.statuses,
        priority: options.priority,
        type: options.type,
      },
    );

    console.log(formatTaskListJson(tasks));
  });
}
