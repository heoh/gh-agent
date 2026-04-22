import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../../core/github.js';
import type { GitHubSignalClient } from '../../core/types.js';
import {
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../../core/workspace.js';
import type { MailboxNotification } from '../../core/types.js';

export interface MailboxListCommandOptions {
  limit?: number;
  cwd?: string;
}

const DEFAULT_LIMIT = 20;

function formatMailboxNotificationsJson(
  notifications: MailboxNotification[],
): string {
  if (notifications.length === 0) {
    return '[]';
  }

  return `[\n  ${notifications.map((notification) => JSON.stringify(notification)).join(',\n  ')}\n]`;
}

export async function mailboxListCommand(
  options: MailboxListCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();
  const limit =
    typeof options.limit === 'number' && Number.isFinite(options.limit)
      ? Math.max(0, Math.trunc(options.limit))
      : DEFAULT_LIMIT;

  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);

    await ensureWorkspaceStructure(paths);

    const authStatus = await githubClient.getAuthStatus(paths);
    if (authStatus.kind !== 'authenticated') {
      throw new GitHubAuthError(authStatus.detail);
    }

    const notifications = await githubClient.listMailboxNotifications(paths, {
      limit,
    });

    console.log(formatMailboxNotificationsJson(notifications));
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
