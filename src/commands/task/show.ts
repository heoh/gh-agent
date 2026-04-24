import type { GitHubSignalClient } from '../../core/types.js';
import { TaskCommandOptions, withTaskCommandContext } from './common.js';

export async function taskShowCommand(
  taskId: string,
  options: TaskCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  await withTaskCommandContext(options, dependencies, async (context) => {
    const task = await context.githubClient.getTaskCard(
      context.paths,
      context.config,
      taskId,
    );

    console.log(JSON.stringify(task, null, 2));
  });
}
