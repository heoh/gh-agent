import {
  createGitHubSignalClient,
  GitHubAuthError,
  GitHubConfigError,
} from '../../core/github.js';
import type {
  GitHubSignalClient,
  MailboxIgnoreErrorResult,
  MailboxIgnoreResult,
} from '../../core/types.js';
import {
  ensureWorkspaceStructure,
  findWorkspaceRoot,
  getWorkspacePaths,
  WorkspaceNotFoundError,
} from '../../core/workspace.js';

export interface MailboxIgnoreCommandOptions {
  cwd?: string;
}

function formatIgnoreResultsJson(results: MailboxIgnoreResult[]): string {
  if (results.length === 0) {
    return '[]';
  }

  return `[\n  ${results.map((result) => JSON.stringify(result)).join(',\n  ')}\n]`;
}

function createFailureResult(
  threadId: string,
  error: unknown,
): MailboxIgnoreErrorResult {
  if (error instanceof GitHubAuthError) {
    return {
      threadId,
      ok: false,
      error: error.message,
      errorCategory: 'auth',
    };
  }

  if (error instanceof GitHubConfigError) {
    return {
      threadId,
      ok: false,
      error: error.message,
      errorCategory: 'config',
    };
  }

  return {
    threadId,
    ok: false,
    error:
      error instanceof Error ? error.message : 'Unknown mailbox ignore error',
    errorCategory: 'runtime',
  };
}

export async function mailboxIgnoreCommand(
  threadIds: string[],
  options: MailboxIgnoreCommandOptions = {},
  dependencies: {
    githubClient?: GitHubSignalClient;
  } = {},
): Promise<void> {
  const githubClient = dependencies.githubClient ?? createGitHubSignalClient();

  try {
    const workspaceRoot = await findWorkspaceRoot(options.cwd);
    const paths = getWorkspacePaths(workspaceRoot);

    await ensureWorkspaceStructure(paths);

    const authStatus = await githubClient.getAuthStatus(paths);

    if (authStatus.kind !== 'authenticated') {
      throw new GitHubAuthError(authStatus.detail);
    }

    const results: MailboxIgnoreResult[] = [];

    for (const threadId of threadIds) {
      try {
        await githubClient.markMailboxThreadAsRead(paths, threadId);
        results.push({
          threadId,
          ok: true,
          read: true,
        });
      } catch (error) {
        results.push(createFailureResult(threadId, error));
      }
    }

    console.log(formatIgnoreResultsJson(results));

    if (results.some((result) => !result.ok)) {
      throw Object.assign(
        new Error('One or more mailbox thread ignores failed.'),
        { exitCode: 1 },
      );
    }
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
